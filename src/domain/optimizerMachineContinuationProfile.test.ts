import { HiGHS, Model, sum } from '@bubblyworld/highs-ts'
import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { machineOperationBreakdownForSelection } from './optimizerCertificates'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'
import type { ProductionStepKind } from './productionPlan'

const PRODUCTION_UNITS_FIX = 35
const ASSIGNED_INGREDIENT_COST_FIX = 3853
const PRODUCTION_COST_FIX = 1948
const SERVICEABLE_CUSTOMER_COUNT = 69
const GLOBAL_SERVING_SLACK =
  PRODUCTION_UNITS_FIX * 2 - SERVICEABLE_CUSTOMER_COUNT
const SLACK_RECIPE_COST =
  PRODUCTION_COST_FIX * 2 - ASSIGNED_INGREDIENT_COST_FIX

const profileIt =
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env?.MACHINE_CONTINUATION_PROFILE === '1'
    ? it
    : it.skip

function canonicalDomain(): BatchOptimizationModel {
  const currentProgress = 'liquid-blender-unlocked'
  const customerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)

  const request: OptimizationRequest = {
    customerIds,
    currentProgress,
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
      'ibex-statue': 999,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'allow-unambiguous-computed',
    objective: 'minimum-waste',
    priorities: ['minimum-waste', 'maximum-ingredient-cost'],
    availableJuiceJarCount: 5,
  }

  return buildOptimizationModel(request, {
    customers: canonicalCustomers,
    candidatePool: buildRecipeCandidatePool(currentProgress),
  })
}

interface PairGroup {
  key: string
  recipes: EligibleOptimizationRecipe[]
  eligibleCustomerIds: string[]
  ingredientCost: number
}

function pairGroups(domain: BatchOptimizationModel): PairGroup[] {
  const groups = new Map<string, PairGroup>()

  for (const recipe of domain.recipes) {
    const eligibleCustomerIds = [
      ...recipe.eligibleCustomerIds,
    ].sort()
    const ingredientCost = recipe.juiceUnitIngredientCost
    const key =
      `${eligibleCustomerIds.join('\u001e')}\u001d${ingredientCost}`
    const current = groups.get(key)
    if (current) current.recipes.push(recipe)
    else {
      groups.set(key, {
        key,
        recipes: [recipe],
        eligibleCustomerIds,
        ingredientCost,
      })
    }
  }

  return [...groups.values()]
}

function partitionSignature(
  recipe: EligibleOptimizationRecipe,
  kinds: ReadonlySet<ProductionStepKind>,
): {
  key: string
  multiplicityByEdgeKey: Map<string, number>
} {
  const multiplicityByEdgeKey = new Map<string, number>()

  for (const edge of recipe.productionPath.edges) {
    if (!kinds.has(edge.kind)) continue
    multiplicityByEdgeKey.set(
      edge.key,
      (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
    )
  }

  return {
    key: [...multiplicityByEdgeKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([edgeKey, multiplicity]) =>
        `${edgeKey}*${multiplicity}`,
      )
      .join('\u001f'),
    multiplicityByEdgeKey,
  }
}

/**
 * Exact under the current post-maximum-cost parity gate:
 * - every produced unit yields two servings;
 * - there are no initial finished servings;
 * - global serving slack is zero or one;
 * - recipes in a group have the same customer eligibility and unit cost.
 *
 * For fixed integer group production, customer assignment is a bipartite
 * flow with integral capacities/demands, so continuous flow variables do not
 * relax the feasible integer group-production set. When slack is one, route
 * one virtual serving only through groups whose cost equals
 * 2 * productionCost - assignedCost. This makes the assigned-cost fix
 * redundant while preserving it exactly.
 */
function buildFullMachineCapFeasibility(
  domain: BatchOptimizationModel,
  totalCap: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const assignmentsByGroupKey = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(groups.map((group) => [group.key, []]))
  const assignedCostTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  let assignmentVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['boolVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.boolVar(
          `y_${customerIndex}_${groupIndex}`,
        )
        assignmentVariableCount += 1
        customerTerms.push(y)
        assignmentsByGroupKey.get(group.key)!.push(y)
        assignedCostTerms.push(y.times(group.ingredientCost))
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  const finalizingGroupIndexByEdgeKey = new Map<string, number>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
        if (edge.kind === 'finalizing') {
          finalizingGroupIndexByEdgeKey.set(edge.key, groupIndex)
        }
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const assignedCustomers = sum(
      ...(assignmentsByGroupKey.get(group.key) ?? []),
    )
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(assignedCustomers)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(assignedCustomers)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...assignedCostTerms).eq(ASSIGNED_INGREDIENT_COST_FIX),
    'assigned_cost_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  const partitionOperationVars = {
    throughSeasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        partitionOperationVars.throughSeasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...partitionOperationVars.throughSeasoning).geq(38),
    'through_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.blending).geq(35),
    'blending_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).geq(30),
    'finalizing_lower_bound',
  )
  model.addConstraint(
    sum(...operationVars).leq(totalCap),
    'machine_total_cap',
  )
  model.minimize(sum(...productionUnitTerms))

  return {
    model,
    groupCount: groups.length,
    assignmentVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    operationEdgeCount: operationVars.length,
  }
}


function buildPartitionOptimalPairStage(
  domain: BatchOptimizationModel,
  partitionKinds: ReadonlySet<ProductionStepKind>,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const coverageByCustomerId = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(domain.serviceableCustomerIds.map((id) => [id, []]))
  const unitVarsByGroupKey = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(groups.map((group) => [group.key, []]))
  const allUnitVars: ReturnType<Model['boolVar']>[] = []
  const singletonVars: ReturnType<Model['boolVar']>[] = []
  const assignedCostTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  const addCoverage = (
    customerId: string,
    variable: ReturnType<Model['boolVar']>,
  ) => {
    const terms = coverageByCustomerId.get(customerId)
    if (!terms) throw new Error(`Unknown customer ${customerId}`)
    terms.push(variable)
  }

  groups.forEach((group, groupIndex) => {
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      group.eligibleCustomerIds.forEach(
        (customerId, customerIndex) => {
          const singleton = model.boolVar(
            `single_${groupIndex}_${customerIndex}`,
          )
          singletonVars.push(singleton)
          allUnitVars.push(singleton)
          unitVarsByGroupKey.get(group.key)!.push(singleton)
          addCoverage(customerId, singleton)
          assignedCostTerms.push(
            singleton.times(group.ingredientCost),
          )
        },
      )
    }

    for (
      let leftIndex = 0;
      leftIndex < group.eligibleCustomerIds.length;
      leftIndex += 1
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < group.eligibleCustomerIds.length;
        rightIndex += 1
      ) {
        const pair = model.boolVar(
          `pair_${groupIndex}_${leftIndex}_${rightIndex}`,
        )
        allUnitVars.push(pair)
        unitVarsByGroupKey.get(group.key)!.push(pair)
        addCoverage(group.eligibleCustomerIds[leftIndex], pair)
        addCoverage(group.eligibleCustomerIds[rightIndex], pair)
        assignedCostTerms.push(
          pair.times(group.ingredientCost * 2),
        )
      }
    }
  })

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      model.addConstraint(
        sum(...(coverageByCustomerId.get(customerId) ?? [])).eq(1),
        `cover_${customerIndex}`,
      )
    },
  )
  model.addConstraint(sum(...singletonVars).eq(1), 'singleton_total')
  model.addConstraint(
    sum(...allUnitVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...assignedCostTerms).eq(ASSIGNED_INGREDIENT_COST_FIX),
    'assigned_cost_fix',
  )

  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  let quotientVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const signatures = new Map<
      string,
      ReturnType<typeof partitionSignature>
    >()
    for (const recipe of group.recipes) {
      const signature = partitionSignature(recipe, partitionKinds)
      if (!signatures.has(signature.key)) {
        signatures.set(signature.key, signature)
      }
    }

    const upperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const quotientVars: ReturnType<Model['intVar']>[] = []

    for (const signature of signatures.values()) {
      const x = model.intVar(
        0,
        upperBound,
        `qx_${quotientVariableCount}`,
      )
      quotientVariableCount += 1
      quotientVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))
      for (const [edgeKey, multiplicity] of signature.multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            upperBound * multiplicity,
        )
      }
    }

    model.addConstraint(
      sum(...quotientVars)
        .minus(sum(...(unitVarsByGroupKey.get(group.key) ?? [])))
        .eq(0),
      `group_units_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
    },
  )

  model.minimize(sum(...operationVars))
  return {
    model,
    groups,
    unitVarsByGroupKey,
    quotientVariableCount,
    operationEdgeCount: operationVars.length,
  }
}

function buildFixedGroupFullMachineStage(
  domain: BatchOptimizationModel,
  unitsByGroupKey: Map<string, number>,
) {
  const groups = pairGroups(domain).filter(
    (group) => (unitsByGroupKey.get(group.key) ?? 0) > 0,
  )
  const model = new Model()
  const xByRecipeId = new Map<string, ReturnType<Model['intVar']>>()
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()

  let recipeVariableCount = 0
  for (const group of groups) {
    const groupUnits = unitsByGroupKey.get(group.key) ?? 0
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUnits,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      xByRecipeId.set(recipe.candidate.id, x)
      groupRecipeVars.push(x)

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUnits * multiplicity,
        )
      }
    }

    model.addConstraint(
      sum(...groupRecipeVars).eq(groupUnits),
      `group_units_${groups.indexOf(group)}`,
    )
  }

  const operationVars: ReturnType<Model['intVar']>[] = []
  const throughOperationVars: ReturnType<Model['intVar']>[] = []
  const blendingOperationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
    },
  )
  model.minimize(sum(...operationVars))

  return {
    model,
    xByRecipeId,
    selectedGroupCount: groups.length,
    recipeVariableCount,
    operationEdgeCount: operationVars.length,
  }
}


function buildFlowProjectedFullMachineCapFeasibility(
  domain: BatchOptimizationModel,
  totalCap: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  const partitionOperationVars = {
    throughSeasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }
  const finalizingOperationVarsByGroup = groups.map(
    () => [] as ReturnType<Model['intVar']>[],
  )

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        partitionOperationVars.throughSeasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...partitionOperationVars.throughSeasoning).geq(38),
    'through_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.blending).geq(35),
    'blending_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).geq(30),
    'finalizing_lower_bound',
  )
  model.addConstraint(
    sum(...operationVars).leq(totalCap),
    'machine_total_cap',
  )

  // Pure feasibility; all production units are already fixed to 35.
  model.minimize(sum(...productionUnitTerms))

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    operationEdgeCount: operationVars.length,
  }
}



function buildFlowProjectedFullMachineObjectiveStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  const partitionOperationVars = {
    throughSeasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'finalizing') {
        model.addConstraint(
          operation
            .times(PROCESSING_STACK_CAPACITY)
            .minus(quantity)
            .leq(PROCESSING_STACK_CAPACITY - 1),
          `finalizing_exact_ceiling_${edgeIndex}`,
        )
      } else {
        model.addConstraint(
          operation.minus(quantity).leq(0),
          `op_usage_${edgeIndex}`,
        )
      }
      operationVars.push(operation)

      if (kind === 'juicing' || kind === 'seasoning') {
        partitionOperationVars.throughSeasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...partitionOperationVars.throughSeasoning).geq(38),
    'through_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.blending).geq(35),
    'blending_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).geq(30),
    'finalizing_lower_bound',
  )
  model.minimize(sum(...operationVars))

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    operationEdgeCount: operationVars.length,
    finalizingOperationEdgeCount:
      partitionOperationVars.finalizing.length,
  }
}


function buildFlowProjectedNonfinalStage(
  domain: BatchOptimizationModel,
  options?: {
    totalCap?: number
    throughExact?: number
    blendingCap?: number
  },
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'finalizing') continue
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  const throughOperationVars: ReturnType<Model['intVar']>[] = []
  const blendingOperationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        throughOperationVars.push(operation)
      } else if (kind === 'blending') {
        blendingOperationVars.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...throughOperationVars).geq(38),
    'through_exact_lower_bound',
  )
  model.addConstraint(
    sum(...blendingOperationVars).geq(35),
    'blending_exact_lower_bound',
  )
  if (typeof options?.throughExact === 'number') {
    model.addConstraint(
      sum(...throughOperationVars).eq(options.throughExact),
      'through_exact',
    )
  }
  if (typeof options?.blendingCap === 'number') {
    model.addConstraint(
      sum(...blendingOperationVars).leq(options.blendingCap),
      'blending_cap',
    )
  }
  if (typeof options?.totalCap === 'number') {
    model.addConstraint(
      sum(...operationVars).leq(options.totalCap),
      'nonfinal_total_cap',
    )
  }

  model.minimize(sum(...operationVars))

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    operationEdgeCount: operationVars.length,
  }
}


function nonfinalEdgeMultiplicity(
  recipe: EligibleOptimizationRecipe,
): Map<string, number> {
  const result = new Map<string, number>()
  for (const edge of recipe.productionPath.edges) {
    if (edge.kind === 'finalizing') continue
    result.set(edge.key, (result.get(edge.key) ?? 0) + 1)
  }
  return result
}

function edgeMultiplicityIsSubset(
  subset: ReadonlyMap<string, number>,
  superset: ReadonlyMap<string, number>,
): boolean {
  for (const [edgeKey, count] of subset) {
    if ((superset.get(edgeKey) ?? 0) < count) return false
  }
  return true
}

function exactDominatedRecipeIds(
  domain: BatchOptimizationModel,
): Set<string> {
  const dominated = new Set<string>()

  for (const group of pairGroups(domain)) {
    const signatures = group.recipes.map((recipe) => ({
      recipe,
      edges: nonfinalEdgeMultiplicity(recipe),
    }))

    for (let candidateIndex = 0; candidateIndex < signatures.length; candidateIndex += 1) {
      const candidate = signatures[candidateIndex]
      for (let replacementIndex = 0; replacementIndex < signatures.length; replacementIndex += 1) {
        if (candidateIndex === replacementIndex) continue
        const replacement = signatures[replacementIndex]

        if (
          edgeMultiplicityIsSubset(
            replacement.edges,
            candidate.edges,
          )
        ) {
          const strictlyBetter =
            replacement.edges.size < candidate.edges.size ||
            [...candidate.edges.entries()].some(
              ([edgeKey, count]) =>
                (replacement.edges.get(edgeKey) ?? 0) < count,
            )
          if (strictlyBetter) {
            dominated.add(candidate.recipe.candidate.id)
            break
          }
        }
      }
    }
  }

  return dominated
}



function buildFlowProjectedKindsStage(
  domain: BatchOptimizationModel,
  kinds: ReadonlySet<ProductionStepKind>,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (!kinds.has(edge.kind)) continue
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          Math.min(
            PRODUCTION_UNITS_FIX * multiplicity,
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
              groupUpperBound * multiplicity,
          ),
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
    },
  )

  model.minimize(sum(...operationVars))
  return {
    model,
    recipeVariableCount,
    operationEdgeCount: operationVars.length,
  }
}


function crossGroupDominatedRecipeIds(
  domain: BatchOptimizationModel,
): {
  dominated: Set<string>
  comparisonCount: number
  maxCostBucketSize: number
} {
  const customerBit = new Map(
    domain.serviceableCustomerIds.map(
      (customerId, index) => [customerId, 1n << BigInt(index)],
    ),
  )
  const byCost = new Map<
    number,
    Array<{
      recipe: EligibleOptimizationRecipe
      eligibleMask: bigint
      eligibleCount: number
      edges: Map<string, number>
      edgeMultiplicityTotal: number
    }>
  >()

  for (const recipe of domain.recipes) {
    let eligibleMask = 0n
    for (const customerId of recipe.eligibleCustomerIds) {
      eligibleMask |= customerBit.get(customerId) ?? 0n
    }
    const edges = nonfinalEdgeMultiplicity(recipe)
    const entry = {
      recipe,
      eligibleMask,
      eligibleCount: recipe.eligibleCustomerIds.length,
      edges,
      edgeMultiplicityTotal: [...edges.values()].reduce(
        (total, count) => total + count,
        0,
      ),
    }
    const bucket = byCost.get(recipe.juiceUnitIngredientCost)
    if (bucket) bucket.push(entry)
    else byCost.set(recipe.juiceUnitIngredientCost, [entry])
  }

  const dominated = new Set<string>()
  let comparisonCount = 0
  let maxCostBucketSize = 0

  for (const bucket of byCost.values()) {
    maxCostBucketSize = Math.max(maxCostBucketSize, bucket.length)

    for (const candidate of bucket) {
      for (const replacement of bucket) {
        if (
          candidate.recipe.candidate.id ===
          replacement.recipe.candidate.id
        ) {
          continue
        }
        if (
          replacement.eligibleCount <
          candidate.eligibleCount
        ) {
          continue
        }
        if (
          replacement.edgeMultiplicityTotal >
          candidate.edgeMultiplicityTotal
        ) {
          continue
        }
        if (
          (replacement.eligibleMask &
            candidate.eligibleMask) !==
          candidate.eligibleMask
        ) {
          continue
        }

        comparisonCount += 1
        if (
          !edgeMultiplicityIsSubset(
            replacement.edges,
            candidate.edges,
          )
        ) {
          continue
        }

        const strictlyBetterEligibility =
          replacement.eligibleMask !==
          candidate.eligibleMask
        const strictlyBetterEdges =
          replacement.edgeMultiplicityTotal <
            candidate.edgeMultiplicityTotal ||
          [...candidate.edges.entries()].some(
            ([edgeKey, count]) =>
              (replacement.edges.get(edgeKey) ?? 0) < count,
          )

        if (
          strictlyBetterEligibility ||
          strictlyBetterEdges
        ) {
          dominated.add(candidate.recipe.candidate.id)
          break
        }
      }
    }
  }

  return {
    dominated,
    comparisonCount,
    maxCostBucketSize,
  }
}



function exactIntegralAssignmentForGroupUnits(
  domain: BatchOptimizationModel,
  unitsByGroupKey: ReadonlyMap<string, number>,
): {
  assignedGroupIndexByCustomerId: Map<string, number>
  slackGroupIndex: number
} {
  const groups = pairGroups(domain)
  const slots: Array<{ groupIndex: number }> = []

  groups.forEach((group, groupIndex) => {
    const units = unitsByGroupKey.get(group.key) ?? 0
    for (let slotIndex = 0; slotIndex < units * 2; slotIndex += 1) {
      slots.push({ groupIndex })
    }
  })

  const realDemands = domain.serviceableCustomerIds.map(
    (customerId) => ({
      id: customerId,
      eligibleGroupIndexes: groups.flatMap((group, groupIndex) =>
        group.eligibleCustomerIds.includes(customerId) &&
        (unitsByGroupKey.get(group.key) ?? 0) > 0
          ? [groupIndex]
          : [],
      ),
    }),
  )
  const slackDemand = {
    id: '__slack__',
    eligibleGroupIndexes: groups.flatMap((group, groupIndex) =>
      group.ingredientCost === SLACK_RECIPE_COST &&
      (unitsByGroupKey.get(group.key) ?? 0) > 0
        ? [groupIndex]
        : [],
    ),
  }

  expect(slots).toHaveLength(
    domain.serviceableCustomerIds.length + GLOBAL_SERVING_SLACK,
  )
  expect(slackDemand.eligibleGroupIndexes.length).toBeGreaterThan(0)

  const demands = [slackDemand, ...realDemands].sort(
    (left, right) =>
      left.eligibleGroupIndexes.length -
      right.eligibleGroupIndexes.length,
  )
  const slotOwner = new Array<number>(slots.length).fill(-1)

  const tryAssign = (
    demandIndex: number,
    visitedSlots: Set<number>,
  ): boolean => {
    const demand = demands[demandIndex]
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      if (visitedSlots.has(slotIndex)) continue
      if (
        !demand.eligibleGroupIndexes.includes(
          slots[slotIndex].groupIndex,
        )
      ) {
        continue
      }
      visitedSlots.add(slotIndex)
      const previousOwner = slotOwner[slotIndex]
      if (
        previousOwner < 0 ||
        tryAssign(previousOwner, visitedSlots)
      ) {
        slotOwner[slotIndex] = demandIndex
        return true
      }
    }
    return false
  }

  for (let demandIndex = 0; demandIndex < demands.length; demandIndex += 1) {
    if (!tryAssign(demandIndex, new Set())) {
      throw new Error(
        `Unable to lift group units into an integral assignment for ${demands[demandIndex].id}`,
      )
    }
  }

  const assignedGroupIndexByCustomerId = new Map<string, number>()
  let slackGroupIndex = -1
  slotOwner.forEach((demandIndex, slotIndex) => {
    if (demandIndex < 0) return
    const demand = demands[demandIndex]
    const groupIndex = slots[slotIndex].groupIndex
    if (demand.id === '__slack__') slackGroupIndex = groupIndex
    else assignedGroupIndexByCustomerId.set(demand.id, groupIndex)
  })

  expect(assignedGroupIndexByCustomerId.size).toBe(
    domain.serviceableCustomerIds.length,
  )
  if (slackGroupIndex < 0) {
    throw new Error('No slack group was assigned')
  }

  return {
    assignedGroupIndexByCustomerId,
    slackGroupIndex,
  }
}

function mipStartValuesForNonfinalWitness(
  domain: BatchOptimizationModel,
  selectedUnitsByRecipeId: ReadonlyMap<string, number>,
): Map<string, number> {
  const groups = pairGroups(domain)
  const unitsByGroupKey = new Map<string, number>()

  for (const group of groups) {
    unitsByGroupKey.set(
      group.key,
      group.recipes.reduce(
        (total, recipe) =>
          total +
          (selectedUnitsByRecipeId.get(recipe.candidate.id) ?? 0),
        0,
      ),
    )
  }

  const assignment = exactIntegralAssignmentForGroupUnits(
    domain,
    unitsByGroupKey,
  )
  const values = new Map<string, number>()

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const groupIndex =
        assignment.assignedGroupIndexByCustomerId.get(customerId)
      if (typeof groupIndex !== 'number') {
        throw new Error(
          `Missing integral assignment for ${customerId}`,
        )
      }
      values.set(`y_${customerIndex}_${groupIndex}`, 1)
    },
  )
  values.set(`slack_${assignment.slackGroupIndex}`, 1)

  const quantityByEdgeKey = new Map<string, number>()
  const edgeIndexByKey = new Map<string, number>()
  let recipeVariableIndex = 0

  for (const group of groups) {
    for (const recipe of group.recipes) {
      const units =
        selectedUnitsByRecipeId.get(recipe.candidate.id) ?? 0
      if (units > 0) {
        values.set(`x_${recipeVariableIndex}`, units)
      }
      recipeVariableIndex += 1

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'finalizing') continue
        if (!edgeIndexByKey.has(edge.key)) {
          edgeIndexByKey.set(edge.key, edgeIndexByKey.size)
        }
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }
      if (units <= 0) continue
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        quantityByEdgeKey.set(
          edgeKey,
          (quantityByEdgeKey.get(edgeKey) ?? 0) +
            units * multiplicity,
        )
      }
    }
  }

  for (const [edgeKey, quantity] of quantityByEdgeKey) {
    if (quantity <= 0) continue
    const edgeIndex = edgeIndexByKey.get(edgeKey)
    if (typeof edgeIndex !== 'number') {
      throw new Error(`Missing operation index for ${edgeKey}`)
    }
    values.set(
      `op_${edgeIndex}`,
      Math.ceil(quantity / PROCESSING_STACK_CAPACITY),
    )
  }

  return values
}


function mipStartValuesForFullWitness(
  domain: BatchOptimizationModel,
  selectedUnitsByRecipeId: ReadonlyMap<string, number>,
): Map<string, number> {
  const groups = pairGroups(domain)
  const unitsByGroupKey = new Map<string, number>()

  for (const group of groups) {
    unitsByGroupKey.set(
      group.key,
      group.recipes.reduce(
        (total, recipe) =>
          total +
          (selectedUnitsByRecipeId.get(recipe.candidate.id) ?? 0),
        0,
      ),
    )
  }

  const assignment = exactIntegralAssignmentForGroupUnits(
    domain,
    unitsByGroupKey,
  )
  const values = new Map<string, number>()

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const groupIndex =
        assignment.assignedGroupIndexByCustomerId.get(customerId)
      if (typeof groupIndex !== 'number') {
        throw new Error(
          `Missing integral assignment for ${customerId}`,
        )
      }
      values.set(`y_${customerIndex}_${groupIndex}`, 1)
    },
  )
  values.set(`slack_${assignment.slackGroupIndex}`, 1)

  const quantityByEdgeKey = new Map<string, number>()
  const edgeIndexByKey = new Map<string, number>()
  let recipeVariableIndex = 0

  for (const group of groups) {
    for (const recipe of group.recipes) {
      const units =
        selectedUnitsByRecipeId.get(recipe.candidate.id) ?? 0
      if (units > 0) {
        values.set(`x_${recipeVariableIndex}`, units)
      }
      recipeVariableIndex += 1

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (!edgeIndexByKey.has(edge.key)) {
          edgeIndexByKey.set(edge.key, edgeIndexByKey.size)
        }
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }
      if (units <= 0) continue
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        quantityByEdgeKey.set(
          edgeKey,
          (quantityByEdgeKey.get(edgeKey) ?? 0) +
            units * multiplicity,
        )
      }
    }
  }

  for (const [edgeKey, quantity] of quantityByEdgeKey) {
    if (quantity <= 0) continue
    const edgeIndex = edgeIndexByKey.get(edgeKey)
    if (typeof edgeIndex !== 'number') {
      throw new Error(`Missing operation index for ${edgeKey}`)
    }
    values.set(
      `op_${edgeIndex}`,
      Math.ceil(quantity / PROCESSING_STACK_CAPACITY),
    )
  }

  return values
}


function miplibSolutionText(
  objective: number,
  values: ReadonlyMap<string, number>,
): string {
  return [
    `=obj= ${objective}`,
    ...[...values.entries()]
      .filter(([, value]) => value !== 0)
      .map(([name, value]) => `${name} ${value}`),
    '',
  ].join('\n')
}

async function solveBoundedWithMIPStart(
  model: Model,
  startValues: ReadonlyMap<string, number>,
  startObjective: number,
  timeLimitSeconds: number,
): Promise<{
  status: string
  objective: number | null
  solveMs: number
  progressTail: string[]
}> {
  const progress: string[] = []
  const highs = await HiGHS.create({
    console: {
      log: (message: string) => progress.push(message),
      error: (message: string) => progress.push(message),
    },
  })
  const startPath = '/tmp/machine-start.sol'
  const runtime = highs as unknown as {
    module: {
      FS: {
        writeFile(path: string, content: string): void
        unlink(path: string): void
      }
    }
  }

  try {
    await highs.parse(model.print('mps'), 'mps')
    runtime.module.FS.writeFile(
      startPath,
      miplibSolutionText(startObjective, startValues),
    )
    highs.setParam('read_solution_file', startPath)
    highs.setParam('time_limit', timeLimitSeconds)
    highs.setParam('mip_rel_gap', 0)
    highs.setParam('mip_abs_gap', 0)

    const startedAt = performance.now()
    const solution = await highs.solve()
    const solveMs = performance.now() - startedAt
    return {
      status: solution.status,
      objective:
        typeof solution.objective === 'number' &&
        Number.isFinite(solution.objective)
          ? solution.objective
          : null,
      solveMs,
      progressTail: progress.slice(-60),
    }
  } finally {
    try {
      runtime.module.FS.unlink(startPath)
    } catch {
      // The solver may have failed before the file was written.
    }
    highs.free()
  }
}


async function solveBoundedWithProgress(
  model: Model,
  timeLimitSeconds: number,
  params?: Readonly<Record<string, boolean | number | string>>,
): Promise<{
  status: string
  objective: number | null
  solveMs: number
  progressTail: string[]
}> {
  const progress: string[] = []
  const highs = await HiGHS.create({
    console: {
      log: (message: string) => progress.push(message),
      error: (message: string) => progress.push(message),
    },
  })
  try {
    await highs.parse(model.print('mps'), 'mps')
    highs.setParam('time_limit', timeLimitSeconds)
    for (const [name, value] of Object.entries(params ?? {})) {
      highs.setParam(name, value)
    }
    const startedAt = performance.now()
    const solution = await highs.solve()
    const solveMs = performance.now() - startedAt
    return {
      status: solution.status,
      objective:
        typeof solution.objective === 'number' &&
        Number.isFinite(solution.objective)
          ? solution.objective
          : null,
      solveMs,
      progressTail: progress.slice(-40),
    }
  } finally {
    highs.free()
  }
}


function buildConditionalThroughFrontierStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const partitionOperationVars = {
    throughSeasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        partitionOperationVars.throughSeasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...partitionOperationVars.blending).eq(35),
    'blending_exact_frontier',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).eq(30),
    'finalizing_exact_frontier',
  )
  model.minimize(
    sum(...partitionOperationVars.throughSeasoning),
  )

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    throughOperationEdgeCount:
      partitionOperationVars.throughSeasoning.length,
    blendingOperationEdgeCount:
      partitionOperationVars.blending.length,
    finalizingOperationEdgeCount:
      partitionOperationVars.finalizing.length,
  }
}


function buildConditionalSeasoningFrontierStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const partitionOperationVars = {
    juicing: [] as ReturnType<Model['intVar']>[],
    seasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing') {
        partitionOperationVars.juicing.push(operation)
      } else if (kind === 'seasoning') {
        partitionOperationVars.seasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...partitionOperationVars.juicing).geq(20),
    'juicing_global_lower_bound',
  )
  model.addConstraint(
    sum(
      ...partitionOperationVars.juicing,
      ...partitionOperationVars.seasoning,
    ).geq(38),
    'through_global_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.blending).eq(35),
    'blending_exact_frontier',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).eq(30),
    'finalizing_exact_frontier',
  )
  model.minimize(sum(...partitionOperationVars.seasoning))

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    juicingOperationEdgeCount:
      partitionOperationVars.juicing.length,
    seasoningOperationEdgeCount:
      partitionOperationVars.seasoning.length,
    blendingOperationEdgeCount:
      partitionOperationVars.blending.length,
    finalizingOperationEdgeCount:
      partitionOperationVars.finalizing.length,
  }
}


function buildConditionalThroughCapFeasibility(
  domain: BatchOptimizationModel,
  throughCap: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const partitionOperationVars = {
    throughSeasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        partitionOperationVars.throughSeasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  const through = sum(...partitionOperationVars.throughSeasoning)
  model.addConstraint(through.geq(38), 'through_exact_lower_bound')
  model.addConstraint(
    through.leq(throughCap),
    'through_candidate_cap',
  )
  model.addConstraint(
    sum(...partitionOperationVars.blending).eq(35),
    'blending_exact_frontier',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).eq(30),
    'finalizing_exact_frontier',
  )

  // Pure feasibility: production units are already fixed to 35.
  model.minimize(sum(...productionUnitTerms))

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    throughOperationEdgeCount:
      partitionOperationVars.throughSeasoning.length,
    blendingOperationEdgeCount:
      partitionOperationVars.blending.length,
    finalizingOperationEdgeCount:
      partitionOperationVars.finalizing.length,
  }
}


function buildFinalizingOptimalGroupCountStage(
  domain: BatchOptimizationModel,
  objective: 'minimum-groups' | 'maximum-groups',
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        terms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const finalOperationVars: ReturnType<Model['intVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []

  groups.forEach((group, groupIndex) => {
    const upperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const x = model.intVar(0, upperBound, `gx_${groupIndex}`)
    productionVars.push(x)
    productionCostTerms.push(x.times(group.ingredientCost))

    const served = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      model.addConstraint(
        x.times(2).minus(served).minus(slack).eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        x.times(2).minus(served).eq(0),
        `parity_${groupIndex}`,
      )
    }

    const op = model.intVar(
      0,
      Math.max(1, Math.ceil(upperBound / PROCESSING_STACK_CAPACITY)),
      `fop_${groupIndex}`,
    )
    finalOperationVars.push(op)
    model.addConstraint(
      x.minus(op.times(PROCESSING_STACK_CAPACITY)).leq(0),
      `fop_capacity_${groupIndex}`,
    )
    model.addConstraint(
      op.minus(x).leq(0),
      `fop_usage_${groupIndex}`,
    )

    const used = model.boolVar(`used_${groupIndex}`)
    usedGroupVars.push(used)
    model.addConstraint(
      x.minus(used.times(upperBound)).leq(0),
      `used_upper_${groupIndex}`,
    )
    model.addConstraint(
      used.minus(x).leq(0),
      `used_lower_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...finalOperationVars).eq(30),
    'finalizing_optimum_fix',
  )

  if (objective === 'minimum-groups') {
    model.minimize(sum(...usedGroupVars))
  } else {
    model.minimize(sum(...usedGroupVars.map((variable) => variable.times(-1))))
  }

  return {
    model,
    groupCount: groups.length,
    usedGroupVars,
  }
}


function buildFinalizing30ReducedStage(
  domain: BatchOptimizationModel,
  objective: 'through' | 'blending' | 'nonfinal-cap' | 'frontier',
  frontier?: {
    blending: number
    throughCap: number
  },
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  let customerFlowVariableCount = 0
  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        terms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()

  let recipeVariableCount = 0
  let recipeUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []
    const groupRecipeUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        Math.min(groupUpperBound, PROCESSING_STACK_CAPACITY),
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      const usedRecipe = model.boolVar(
        `ru_${recipeUseVariableCount}`,
      )
      recipeUseVariableCount += 1

      groupRecipeVars.push(x)
      groupRecipeUseVars.push(usedRecipe)
      productionVars.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      model.addConstraint(
        x
          .minus(
            usedRecipe.times(
              Math.min(groupUpperBound, PROCESSING_STACK_CAPACITY),
            ),
          )
          .leq(0),
        `recipe_use_upper_${recipeVariableCount}`,
      )
      model.addConstraint(
        usedRecipe.minus(x).leq(0),
        `recipe_use_lower_${recipeVariableCount}`,
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'finalizing') continue
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            Math.min(groupUpperBound, PROCESSING_STACK_CAPACITY) *
              multiplicity,
        )
      }
    }

    const groupProduction = sum(...groupRecipeVars)
    const served = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      model.addConstraint(
        groupProduction
          .times(2)
          .minus(served)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction.times(2).minus(served).eq(0),
        `parity_${groupIndex}`,
      )
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupRecipeUseVars).minus(usedGroup).eq(0),
      `one_recipe_per_used_group_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const throughOps: ReturnType<Model['intVar']>[] = []
  const blendingOps: ReturnType<Model['intVar']>[] = []

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        throughOps.push(operation)
      } else if (kind === 'blending') {
        blendingOps.push(operation)
      }
    },
  )

  const through = sum(...throughOps)
  const blending = sum(...blendingOps)
  model.addConstraint(through.geq(38), 'through_lower_bound')
  model.addConstraint(blending.geq(35), 'blending_lower_bound')

  if (objective === 'nonfinal-cap') {
    model.addConstraint(
      through.plus(blending).leq(76),
      'nonfinal_cap_for_total106',
    )
    model.minimize(sum(...productionVars))
  } else if (objective === 'frontier') {
    if (!frontier) {
      throw new Error('Missing finalizing-30 frontier constraints')
    }
    model.addConstraint(
      blending.eq(frontier.blending),
      'blending_frontier_fix',
    )
    model.addConstraint(
      through.leq(frontier.throughCap),
      'through_frontier_cap',
    )
    model.minimize(sum(...productionVars))
  } else if (objective === 'through') {
    model.minimize(through)
  } else {
    model.minimize(blending)
  }

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    recipeUseVariableCount,
    usedGroupVariableCount: usedGroupVars.length,
    throughOperationEdgeCount: throughOps.length,
    blendingOperationEdgeCount: blendingOps.length,
  }
}


function buildFinalizing30Blending35RawThroughStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        terms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const xNameByRecipeId = new Map<string, string>()
  const rawThroughTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const blendingQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const blendingQuantityUpperBoundByEdgeKey =
    new Map<string, number>()

  let recipeVariableCount = 0
  let recipeUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const cappedUpperBound = Math.min(
      groupUpperBound,
      PROCESSING_STACK_CAPACITY,
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []
    const groupRecipeUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipe of group.recipes) {
      const variableName = `x_${recipeVariableCount}`
      const x = model.intVar(
        0,
        cappedUpperBound,
        variableName,
      )
      recipeVariableCount += 1
      xNameByRecipeId.set(recipe.candidate.id, variableName)

      const usedRecipe = model.boolVar(
        `ru_${recipeUseVariableCount}`,
      )
      recipeUseVariableCount += 1

      groupRecipeVars.push(x)
      groupRecipeUseVars.push(usedRecipe)
      productionVars.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      model.addConstraint(
        x.minus(usedRecipe.times(cappedUpperBound)).leq(0),
        `recipe_use_upper_${recipeVariableCount}`,
      )
      model.addConstraint(
        usedRecipe.minus(x).leq(0),
        `recipe_use_lower_${recipeVariableCount}`,
      )

      let rawThroughMultiplicity = 0
      const blendingMultiplicityByEdgeKey = new Map<string, number>()

      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'juicing' || edge.kind === 'seasoning') {
          rawThroughMultiplicity += 1
        } else if (edge.kind === 'blending') {
          blendingMultiplicityByEdgeKey.set(
            edge.key,
            (blendingMultiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
          )
        }
      }

      if (rawThroughMultiplicity > 0) {
        rawThroughTerms.push(x.times(rawThroughMultiplicity))
      }

      for (
        const [edgeKey, multiplicity]
        of blendingMultiplicityByEdgeKey
      ) {
        const terms = blendingQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else blendingQuantityTermsByEdgeKey.set(edgeKey, [term])
        blendingQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (blendingQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            cappedUpperBound * multiplicity,
        )
      }
    }

    const groupProduction = sum(...groupRecipeVars)
    const served = sum(...(flowByGroupKey.get(group.key) ?? []))

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      model.addConstraint(
        groupProduction
          .times(2)
          .minus(served)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction.times(2).minus(served).eq(0),
        `parity_${groupIndex}`,
      )
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupRecipeUseVars).minus(usedGroup).eq(0),
      `one_recipe_per_used_group_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const blendingOps: ReturnType<Model['intVar']>[] = []
  ;[...blendingQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (blendingQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      blendingOps.push(operation)
    },
  )

  model.addConstraint(
    sum(...blendingOps).eq(35),
    'blending35_frontier',
  )
  model.minimize(sum(...rawThroughTerms))

  return {
    model,
    xNameByRecipeId,
    recipeVariableCount,
    recipeUseVariableCount,
    blendingOperationEdgeCount: blendingOps.length,
  }
}


function buildFinalizing30CompressedFrontierStage(
  domain: BatchOptimizationModel,
  extraThresholdCounts: readonly [number, number, number, number],
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const customerFlowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(
    [...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]),
  )
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `my_${customerIndex}_${maskIndex}`,
          )
          customerFlowVariableCount += 1
          terms.push(y)
          customerFlowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const blendOwnersByEdgeKey = new Map<string, Set<number>>()
  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind !== 'blending') continue
        const owners =
          blendOwnersByEdgeKey.get(edge.key) ?? new Set<number>()
        owners.add(groupIndex)
        blendOwnersByEdgeKey.set(edge.key, owners)
      }
    }
  })
  const sharedBlendEdgeKeys = new Set(
    [...blendOwnersByEdgeKey.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const extraThresholdVarsByLevel = Array.from(
    { length: PROCESSING_STACK_CAPACITY - 1 },
    () => [] as ReturnType<Model['boolVar']>[],
  )
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const slackVarsByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const groupProductionByIndex = new Map<
    number,
    ReturnType<typeof sum>
  >()
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const throughQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const throughQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const sharedBlendQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const privateBlendOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  let classVariableCount = 0
  let classUseVariableCount = 0
  let maxPrivateBlendMultiplicity = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        through: Map<string, number>
        sharedBlend: Map<string, number>
        privateBlendCount: number
      }
    >()

    for (const recipe of group.recipes) {
      const through = new Map<string, number>()
      const sharedBlend = new Map<string, number>()
      let privateBlendCount = 0

      const blendMultiplicity = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'juicing' || edge.kind === 'seasoning') {
          through.set(
            edge.key,
            (through.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      for (const [edgeKey, multiplicity] of blendMultiplicity) {
        if (sharedBlendEdgeKeys.has(edgeKey)) {
          sharedBlend.set(edgeKey, multiplicity)
        } else {
          maxPrivateBlendMultiplicity = Math.max(
            maxPrivateBlendMultiplicity,
            multiplicity,
          )
          if (multiplicity !== 1) {
            throw new Error(
              `Private blending edge multiplicity ${multiplicity} is not safely reducible`,
            )
          }
          privateBlendCount += 1
        }
      }

      const signature = JSON.stringify({
        t: [...through.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        b: [...sharedBlend.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        p: privateBlendCount,
      })
      if (!classes.has(signature)) {
        classes.set(signature, {
          through,
          sharedBlend,
          privateBlendCount,
        })
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `cx_${classVariableCount}`,
      )
      classVariableCount += 1
      const used = model.boolVar(
        `cu_${classUseVariableCount}`,
      )
      classUseVariableCount += 1
      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `class_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `class_use_lower_${classVariableCount}`,
      )

      for (const [edgeKey, multiplicity] of recipeClass.through) {
        const terms = throughQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else throughQuantityTermsByEdgeKey.set(edgeKey, [term])
        throughQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (throughQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedBlend
      ) {
        const terms =
          sharedBlendQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedBlendQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedBlendQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      if (recipeClass.privateBlendCount > 0) {
        privateBlendOperationTerms.push(
          used.times(recipeClass.privateBlendCount),
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    groupProductionByIndex.set(groupIndex, groupProduction)

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `one_class_per_used_group_${groupIndex}`,
    )

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      slackVarsByGroupIndex.set(groupIndex, slack)
      model.addConstraint(
        slack.minus(usedGroup).leq(0),
        `slack_requires_used_group_${groupIndex}`,
      )
    }

    const extraThresholds = Array.from(
      { length: Math.max(0, groupUpperBound - 1) },
      (_, thresholdIndex) => {
        const threshold = model.boolVar(
          `extra_ge_${thresholdIndex + 1}_${groupIndex}`,
        )
        extraThresholdVarsByLevel[thresholdIndex].push(threshold)
        return threshold
      },
    )
    if (extraThresholds.length === 0) {
      model.addConstraint(
        groupProduction.minus(usedGroup).eq(0),
        `group_exact_extra_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction
          .minus(usedGroup)
          .minus(sum(...extraThresholds))
          .eq(0),
        `group_exact_extra_${groupIndex}`,
      )
      for (
        let thresholdIndex = 1;
        thresholdIndex < extraThresholds.length;
        thresholdIndex += 1
      ) {
        model.addConstraint(
          extraThresholds[thresholdIndex]
            .minus(extraThresholds[thresholdIndex - 1])
            .leq(0),
          `group_extra_monotone_${groupIndex}_${thresholdIndex}`,
        )
      }
    }
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlackVars = groupIndexes.flatMap((groupIndex) => {
      const slack = slackVarsByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlackVars))
        .minus(sum(...(customerFlowByMask.get(maskKey) ?? [])))
        .eq(0),
      `mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )
  model.addConstraint(
    sum(...productionVars)
      .minus(sum(...usedGroupVars))
      .eq(PRODUCTION_UNITS_FIX - 30),
    'finalizing30_exact_extra_units',
  )
  extraThresholdCounts.forEach((count, thresholdIndex) => {
    model.addConstraint(
      sum(...extraThresholdVarsByLevel[thresholdIndex]).eq(count),
      `extra_threshold_count_${thresholdIndex + 1}`,
    )
  })

  const throughOps: ReturnType<Model['intVar']>[] = []
  ;[...throughQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (throughQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `top_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `top_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `top_usage_${edgeIndex}`,
      )
      throughOps.push(operation)
    },
  )

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedBlendQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      sharedBlendOps.push(operation)
    },
  )

  const through = sum(...throughOps)
  const blending = sum(
    ...sharedBlendOps,
    ...privateBlendOperationTerms,
  )
  model.addConstraint(through.geq(38), 'through_lower_bound')
  model.addConstraint(blending.geq(35), 'blending_lower_bound')
  model.minimize(through.plus(blending))

  return {
    model,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
    groupCount: groups.length,
    classVariableCount,
    classUseVariableCount,
    sharedBlendEdgeCount: sharedBlendEdgeKeys.size,
    sharedBlendOperationEdgeCount: sharedBlendOps.length,
    privateBlendOperationTermCount:
      privateBlendOperationTerms.length,
    throughOperationEdgeCount: throughOps.length,
    maxPrivateBlendMultiplicity,
    extraThresholdVariableCount:
      extraThresholdVarsByLevel.reduce(
        (total, variables) => total + variables.length,
        0,
      ),
  }
}


function buildFinalizing30ConditionalSeasoningStage(
  domain: BatchOptimizationModel,
  blendingFix: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        terms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const blendOwnersByEdgeKey = new Map<string, Set<number>>()
  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind !== 'blending') continue
        const owners =
          blendOwnersByEdgeKey.get(edge.key) ?? new Set<number>()
        owners.add(groupIndex)
        blendOwnersByEdgeKey.set(edge.key, owners)
      }
    }
  })
  const sharedBlendEdgeKeys = new Set(
    [...blendOwnersByEdgeKey.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const seasoningQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const seasoningQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const sharedBlendQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const privateBlendOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  let classVariableCount = 0
  let classUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        seasoning: Map<string, number>
        sharedBlend: Map<string, number>
        privateBlendCount: number
      }
    >()

    for (const recipe of group.recipes) {
      const seasoning = new Map<string, number>()
      const sharedBlend = new Map<string, number>()
      let privateBlendCount = 0
      const blendMultiplicity = new Map<string, number>()

      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'seasoning') {
          seasoning.set(
            edge.key,
            (seasoning.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      for (const [edgeKey, multiplicity] of blendMultiplicity) {
        if (sharedBlendEdgeKeys.has(edgeKey)) {
          sharedBlend.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private blending edge multiplicity ${multiplicity} is not safely reducible`,
            )
          }
          privateBlendCount += 1
        }
      }

      const signature = JSON.stringify({
        s: [...seasoning.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        b: [...sharedBlend.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        p: privateBlendCount,
      })
      if (!classes.has(signature)) {
        classes.set(signature, {
          seasoning,
          sharedBlend,
          privateBlendCount,
        })
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `sx_${classVariableCount}`,
      )
      classVariableCount += 1
      const used = model.boolVar(
        `su_${classUseVariableCount}`,
      )
      classUseVariableCount += 1

      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `class_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `class_use_lower_${classVariableCount}`,
      )

      for (
        const [edgeKey, multiplicity]
        of recipeClass.seasoning
      ) {
        const terms =
          seasoningQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else seasoningQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        seasoningQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (seasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedBlend
      ) {
        const terms =
          sharedBlendQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedBlendQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedBlendQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      if (recipeClass.privateBlendCount > 0) {
        privateBlendOperationTerms.push(
          used.times(recipeClass.privateBlendCount),
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    const served = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      model.addConstraint(
        groupProduction
          .times(2)
          .minus(served)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction.times(2).minus(served).eq(0),
        `parity_${groupIndex}`,
      )
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `one_class_per_used_group_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const seasoningOps: ReturnType<Model['intVar']>[] = []
  ;[...seasoningQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (seasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `sop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `sop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `sop_usage_${edgeIndex}`,
      )
      seasoningOps.push(operation)
    },
  )

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedBlendQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      sharedBlendOps.push(operation)
    },
  )

  const blending = sum(
    ...sharedBlendOps,
    ...privateBlendOperationTerms,
  )
  model.addConstraint(
    blending.eq(blendingFix),
    'blending_frontier_fix',
  )
  model.minimize(sum(...seasoningOps))

  return {
    model,
    groupCount: groups.length,
    classVariableCount,
    classUseVariableCount,
    sharedBlendOperationEdgeCount: sharedBlendOps.length,
    privateBlendOperationTermCount:
      privateBlendOperationTerms.length,
    seasoningOperationEdgeCount: seasoningOps.length,
  }
}


function buildFinalizing30DoubleCompressedSeasoningStage(
  domain: BatchOptimizationModel,
  blendingFix: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        terms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const ownersByKind = {
    seasoning: new Map<string, Set<number>>(),
    blending: new Map<string, Set<number>>(),
  }

  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind !== 'seasoning' && edge.kind !== 'blending') {
          continue
        }
        const map = ownersByKind[edge.kind]
        const owners = map.get(edge.key) ?? new Set<number>()
        owners.add(groupIndex)
        map.set(edge.key, owners)
      }
    }
  })

  const sharedSeasoningEdgeKeys = new Set(
    [...ownersByKind.seasoning.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )
  const sharedBlendEdgeKeys = new Set(
    [...ownersByKind.blending.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []

  const sharedSeasoningQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedSeasoningQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const sharedBlendQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendQuantityUpperBoundByEdgeKey =
    new Map<string, number>()

  const privateSeasoningOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const privateBlendOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  let classVariableCount = 0
  let classUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        sharedSeasoning: Map<string, number>
        privateSeasoningCount: number
        sharedBlend: Map<string, number>
        privateBlendCount: number
      }
    >()

    for (const recipe of group.recipes) {
      const sharedSeasoning = new Map<string, number>()
      const sharedBlend = new Map<string, number>()
      let privateSeasoningCount = 0
      let privateBlendCount = 0

      const seasoningMultiplicity = new Map<string, number>()
      const blendMultiplicity = new Map<string, number>()

      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'seasoning') {
          seasoningMultiplicity.set(
            edge.key,
            (seasoningMultiplicity.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      for (const [edgeKey, multiplicity] of seasoningMultiplicity) {
        if (sharedSeasoningEdgeKeys.has(edgeKey)) {
          sharedSeasoning.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private seasoning edge multiplicity ${multiplicity} is not safely reducible`,
            )
          }
          privateSeasoningCount += 1
        }
      }

      for (const [edgeKey, multiplicity] of blendMultiplicity) {
        if (sharedBlendEdgeKeys.has(edgeKey)) {
          sharedBlend.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private blending edge multiplicity ${multiplicity} is not safely reducible`,
            )
          }
          privateBlendCount += 1
        }
      }

      const signature = JSON.stringify({
        ss: [...sharedSeasoning.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        ps: privateSeasoningCount,
        sb: [...sharedBlend.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        pb: privateBlendCount,
      })

      if (!classes.has(signature)) {
        classes.set(signature, {
          sharedSeasoning,
          privateSeasoningCount,
          sharedBlend,
          privateBlendCount,
        })
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `dx_${classVariableCount}`,
      )
      classVariableCount += 1
      const used = model.boolVar(
        `du_${classUseVariableCount}`,
      )
      classUseVariableCount += 1

      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `class_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `class_use_lower_${classVariableCount}`,
      )

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedSeasoning
      ) {
        const terms =
          sharedSeasoningQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedSeasoningQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedSeasoningQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedSeasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedBlend
      ) {
        const terms =
          sharedBlendQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedBlendQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedBlendQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      if (recipeClass.privateSeasoningCount > 0) {
        privateSeasoningOperationTerms.push(
          used.times(recipeClass.privateSeasoningCount),
        )
      }
      if (recipeClass.privateBlendCount > 0) {
        privateBlendOperationTerms.push(
          used.times(recipeClass.privateBlendCount),
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    const served = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      model.addConstraint(
        groupProduction
          .times(2)
          .minus(served)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction.times(2).minus(served).eq(0),
        `parity_${groupIndex}`,
      )
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `one_class_per_used_group_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const sharedSeasoningOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedSeasoningQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedSeasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `sop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `sop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `sop_usage_${edgeIndex}`,
      )
      sharedSeasoningOps.push(operation)
    },
  )

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedBlendQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      sharedBlendOps.push(operation)
    },
  )

  const seasoning = sum(
    ...sharedSeasoningOps,
    ...privateSeasoningOperationTerms,
  )
  const blending = sum(
    ...sharedBlendOps,
    ...privateBlendOperationTerms,
  )

  model.addConstraint(
    blending.eq(blendingFix),
    'blending_frontier_fix',
  )
  model.minimize(seasoning)

  return {
    model,
    groupCount: groups.length,
    classVariableCount,
    classUseVariableCount,
    sharedSeasoningOperationEdgeCount:
      sharedSeasoningOps.length,
    privateSeasoningOperationTermCount:
      privateSeasoningOperationTerms.length,
    sharedBlendOperationEdgeCount: sharedBlendOps.length,
    privateBlendOperationTermCount:
      privateBlendOperationTerms.length,
  }
}


function buildMaskProjectedFinalizing30SeasoningStage(
  domain: BatchOptimizationModel,
  blendingFix: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const customerFlowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(
    [...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]),
  )
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `my_${customerIndex}_${maskIndex}`,
          )
          customerFlowVariableCount += 1
          customerTerms.push(y)
          customerFlowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const ownersByKind = {
    seasoning: new Map<string, Set<number>>(),
    blending: new Map<string, Set<number>>(),
  }
  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind !== 'seasoning' && edge.kind !== 'blending') {
          continue
        }
        const map = ownersByKind[edge.kind]
        const owners = map.get(edge.key) ?? new Set<number>()
        owners.add(groupIndex)
        map.set(edge.key, owners)
      }
    }
  })

  const sharedSeasoningEdgeKeys = new Set(
    [...ownersByKind.seasoning.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )
  const sharedBlendEdgeKeys = new Set(
    [...ownersByKind.blending.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<
    number,
    ReturnType<ReturnType<Model['intVar']>['plus']>
      | ReturnType<Model['intVar']>
      | ReturnType<typeof sum>
  >()
  const slackVarsByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []

  const sharedSeasoningQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedSeasoningQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const sharedBlendQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const privateSeasoningOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const privateBlendOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  let classVariableCount = 0
  let classUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        sharedSeasoning: Map<string, number>
        privateSeasoningCount: number
        sharedBlend: Map<string, number>
        privateBlendCount: number
      }
    >()

    for (const recipe of group.recipes) {
      const sharedSeasoning = new Map<string, number>()
      const sharedBlend = new Map<string, number>()
      let privateSeasoningCount = 0
      let privateBlendCount = 0
      const seasoningMultiplicity = new Map<string, number>()
      const blendMultiplicity = new Map<string, number>()

      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'seasoning') {
          seasoningMultiplicity.set(
            edge.key,
            (seasoningMultiplicity.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      for (const [edgeKey, multiplicity] of seasoningMultiplicity) {
        if (sharedSeasoningEdgeKeys.has(edgeKey)) {
          sharedSeasoning.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private seasoning multiplicity ${multiplicity}`,
            )
          }
          privateSeasoningCount += 1
        }
      }
      for (const [edgeKey, multiplicity] of blendMultiplicity) {
        if (sharedBlendEdgeKeys.has(edgeKey)) {
          sharedBlend.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private blending multiplicity ${multiplicity}`,
            )
          }
          privateBlendCount += 1
        }
      }

      const signature = JSON.stringify({
        ss: [...sharedSeasoning.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        ps: privateSeasoningCount,
        sb: [...sharedBlend.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        pb: privateBlendCount,
      })
      if (!classes.has(signature)) {
        classes.set(signature, {
          sharedSeasoning,
          privateSeasoningCount,
          sharedBlend,
          privateBlendCount,
        })
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `mx_${classVariableCount}`,
      )
      classVariableCount += 1
      const used = model.boolVar(
        `mu_${classUseVariableCount}`,
      )
      classUseVariableCount += 1

      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `class_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `class_use_lower_${classVariableCount}`,
      )

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedSeasoning
      ) {
        const terms =
          sharedSeasoningQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedSeasoningQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedSeasoningQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedSeasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedBlend
      ) {
        const terms =
          sharedBlendQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedBlendQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedBlendQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      if (recipeClass.privateSeasoningCount > 0) {
        privateSeasoningOperationTerms.push(
          used.times(recipeClass.privateSeasoningCount),
        )
      }
      if (recipeClass.privateBlendCount > 0) {
        privateBlendOperationTerms.push(
          used.times(recipeClass.privateBlendCount),
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    groupProductionByIndex.set(groupIndex, groupProduction)

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      slackVarsByGroupIndex.set(groupIndex, slack)
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `one_class_per_used_group_${groupIndex}`,
    )
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlackVars = groupIndexes.flatMap((groupIndex) => {
      const slack = slackVarsByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlackVars))
        .minus(sum(...(customerFlowByMask.get(maskKey) ?? [])))
        .eq(0),
      `mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const sharedSeasoningOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedSeasoningQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedSeasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `sop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `sop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `sop_usage_${edgeIndex}`,
      )
      sharedSeasoningOps.push(operation)
    },
  )

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedBlendQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      sharedBlendOps.push(operation)
    },
  )

  const seasoning = sum(
    ...sharedSeasoningOps,
    ...privateSeasoningOperationTerms,
  )
  const blending = sum(
    ...sharedBlendOps,
    ...privateBlendOperationTerms,
  )
  model.addConstraint(
    blending.eq(blendingFix),
    'blending_frontier_fix',
  )
  model.minimize(seasoning)

  return {
    model,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
    groupCount: groups.length,
    classVariableCount,
    classUseVariableCount,
    sharedSeasoningOperationEdgeCount:
      sharedSeasoningOps.length,
    privateSeasoningOperationTermCount:
      privateSeasoningOperationTerms.length,
    sharedBlendOperationEdgeCount: sharedBlendOps.length,
    privateBlendOperationTermCount:
      privateBlendOperationTerms.length,
  }
}


function buildAggregateSeasoningLowerBoundStage(
  domain: BatchOptimizationModel,
  blendingFix: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const flowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >([...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `ay_${customerIndex}_${maskIndex}`,
          )
          terms.push(y)
          flowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const seasoningOwners = new Map<string, Set<number>>()
  const blendingOwners = new Map<string, Set<number>>()
  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'seasoning') {
          const owners =
            seasoningOwners.get(edge.key) ?? new Set<number>()
          owners.add(groupIndex)
          seasoningOwners.set(edge.key, owners)
        } else if (edge.kind === 'blending') {
          const owners =
            blendingOwners.get(edge.key) ?? new Set<number>()
          owners.add(groupIndex)
          blendingOwners.set(edge.key, owners)
        }
      }
    }
  })
  const sharedSeasoningEdgeKeys = new Set(
    [...seasoningOwners.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([key]) => key),
  )
  const sharedBlendEdgeKeys = new Set(
    [...blendingOwners.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([key]) => key),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<number, ReturnType<typeof sum>>()
  const slackByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []

  const sharedSeasoningQuantityTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  let sharedSeasoningQuantityUpperBound = 0
  const privateSeasoningOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  const sharedBlendQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const privateBlendOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  let classVariableCount = 0
  let classUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        privateSeasoningCount: number
        sharedSeasoningCount: number
        sharedBlend: Map<string, number>
        privateBlendCount: number
      }
    >()

    for (const recipe of group.recipes) {
      let privateSeasoningCount = 0
      let sharedSeasoningCount = 0
      let privateBlendCount = 0
      const sharedBlend = new Map<string, number>()

      const seasoningMultiplicity = new Map<string, number>()
      const blendMultiplicity = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'seasoning') {
          seasoningMultiplicity.set(
            edge.key,
            (seasoningMultiplicity.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      for (const [edgeKey, multiplicity] of seasoningMultiplicity) {
        if (multiplicity !== 1) {
          throw new Error(
            `Seasoning multiplicity ${multiplicity} is not supported`,
          )
        }
        if (sharedSeasoningEdgeKeys.has(edgeKey)) {
          sharedSeasoningCount += 1
        } else {
          privateSeasoningCount += 1
        }
      }

      for (const [edgeKey, multiplicity] of blendMultiplicity) {
        if (multiplicity !== 1) {
          throw new Error(
            `Blending multiplicity ${multiplicity} is not supported`,
          )
        }
        if (sharedBlendEdgeKeys.has(edgeKey)) {
          sharedBlend.set(edgeKey, 1)
        } else {
          privateBlendCount += 1
        }
      }

      const signature = JSON.stringify({
        ps: privateSeasoningCount,
        ss: sharedSeasoningCount,
        sb: [...sharedBlend.keys()].sort(),
        pb: privateBlendCount,
      })
      if (!classes.has(signature)) {
        classes.set(signature, {
          privateSeasoningCount,
          sharedSeasoningCount,
          sharedBlend,
          privateBlendCount,
        })
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `ax_${classVariableCount}`,
      )
      classVariableCount += 1
      const used = model.boolVar(
        `au_${classUseVariableCount}`,
      )
      classUseVariableCount += 1

      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))
      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `class_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `class_use_lower_${classVariableCount}`,
      )

      if (recipeClass.privateSeasoningCount > 0) {
        privateSeasoningOperationTerms.push(
          used.times(recipeClass.privateSeasoningCount),
        )
      }
      if (recipeClass.sharedSeasoningCount > 0) {
        sharedSeasoningQuantityTerms.push(
          x.times(recipeClass.sharedSeasoningCount),
        )
        sharedSeasoningQuantityUpperBound +=
          groupUpperBound * recipeClass.sharedSeasoningCount
      }

      for (const edgeKey of recipeClass.sharedBlend.keys()) {
        const terms =
          sharedBlendQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(1)
        if (terms) terms.push(term)
        else sharedBlendQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedBlendQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound,
        )
      }

      if (recipeClass.privateBlendCount > 0) {
        privateBlendOperationTerms.push(
          used.times(recipeClass.privateBlendCount),
        )
      }
    }

    groupProductionByIndex.set(
      groupIndex,
      sum(...groupProductionVars),
    )

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      slackByGroupIndex.set(groupIndex, slack)
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `one_class_per_used_group_${groupIndex}`,
    )
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlacks = groupIndexes.flatMap((groupIndex) => {
      const slack = slackByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlacks))
        .minus(sum(...(flowByMask.get(maskKey) ?? [])))
        .eq(0),
      `mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const sharedSeasoningOperation = model.intVar(
    0,
    Math.max(
      1,
      Math.ceil(
        sharedSeasoningQuantityUpperBound /
          PROCESSING_STACK_CAPACITY,
      ),
    ),
    'aggregate_shared_seasoning_op',
  )
  const sharedSeasoningQuantity =
    sum(...sharedSeasoningQuantityTerms)
  model.addConstraint(
    sharedSeasoningQuantity
      .minus(
        sharedSeasoningOperation.times(
          PROCESSING_STACK_CAPACITY,
        ),
      )
      .leq(0),
    'aggregate_shared_seasoning_capacity',
  )
  model.addConstraint(
    sharedSeasoningOperation
      .minus(sharedSeasoningQuantity)
      .leq(0),
    'aggregate_shared_seasoning_usage',
  )

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedBlendQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      sharedBlendOps.push(operation)
    },
  )

  const seasoningLowerBound = sum(
    sharedSeasoningOperation,
    ...privateSeasoningOperationTerms,
  )
  const blending = sum(
    ...sharedBlendOps,
    ...privateBlendOperationTerms,
  )
  model.addConstraint(
    blending.eq(blendingFix),
    'blending_frontier_fix',
  )
  model.minimize(seasoningLowerBound)

  return {
    model,
    serviceMaskCount: maskCustomerIds.size,
    groupCount: groups.length,
    classVariableCount,
    classUseVariableCount,
    sharedBlendOperationEdgeCount: sharedBlendOps.length,
    privateBlendOperationTermCount:
      privateBlendOperationTerms.length,
    privateSeasoningOperationTermCount:
      privateSeasoningOperationTerms.length,
  }
}


function buildExactSharedEdgeMachineStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const flowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >([...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `fy_${customerIndex}_${maskIndex}`,
          )
          customerFlowVariableCount += 1
          terms.push(y)
          flowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const ownersByEdge = new Map<string, Set<string>>()
  for (const recipe of domain.recipes) {
    for (const edge of recipe.productionPath.edges) {
      const owners =
        ownersByEdge.get(edge.key) ?? new Set<string>()
      owners.add(recipe.candidate.id)
      ownersByEdge.set(edge.key, owners)
    }
  }
  const sharedEdgeKeys = new Set(
    [...ownersByEdge.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<number, ReturnType<typeof sum>>()
  const slackByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackVars: ReturnType<Model['boolVar']>[] = []

  const quantityTermsBySharedEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundBySharedEdgeKey =
    new Map<string, number>()
  const localOperationTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []

  let classVariableCount = 0
  let localOperationVariableCount = 0
  let collapsedRecipeCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        shared: Map<string, number>
        localCoefficient: number
        recipeCount: number
      }
    >()

    for (const recipe of group.recipes) {
      const multiplicityByEdge = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdge.set(
          edge.key,
          (multiplicityByEdge.get(edge.key) ?? 0) + 1,
        )
      }

      const shared = new Map<string, number>()
      let localCoefficient = 0
      for (const [edgeKey, multiplicity] of multiplicityByEdge) {
        if (sharedEdgeKeys.has(edgeKey)) {
          shared.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private machine edge multiplicity ${multiplicity} is not safely quotientable`,
            )
          }
          localCoefficient += 1
        }
      }

      const signature = JSON.stringify({
        shared: [...shared.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        localCoefficient,
      })
      const current = classes.get(signature)
      if (current) {
        current.recipeCount += 1
      } else {
        classes.set(signature, {
          shared,
          localCoefficient,
          recipeCount: 1,
        })
      }
    }

    collapsedRecipeCount +=
      group.recipes.length - classes.size

    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `qx_${classVariableCount}`,
      )
      classVariableCount += 1
      groupProductionVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      const localOperation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            groupUpperBound / PROCESSING_STACK_CAPACITY,
          ),
        ),
        `lop_${localOperationVariableCount}`,
      )
      localOperationVariableCount += 1
      model.addConstraint(
        x
          .minus(
            localOperation.times(PROCESSING_STACK_CAPACITY),
          )
          .leq(0),
        `local_capacity_${localOperationVariableCount}`,
      )
      model.addConstraint(
        localOperation.minus(x).leq(0),
        `local_usage_${localOperationVariableCount}`,
      )
      localOperationTerms.push(
        localOperation.times(recipeClass.localCoefficient),
      )

      for (const [edgeKey, multiplicity] of recipeClass.shared) {
        const terms =
          quantityTermsBySharedEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsBySharedEdgeKey.set(
          edgeKey,
          [term],
        )
        quantityUpperBoundBySharedEdgeKey.set(
          edgeKey,
          (quantityUpperBoundBySharedEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    groupProductionByIndex.set(groupIndex, groupProduction)

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      slackByGroupIndex.set(groupIndex, slack)
      model.addConstraint(
        slack.minus(groupProduction).leq(0),
        `slack_requires_production_${groupIndex}`,
      )
    }
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlacks = groupIndexes.flatMap((groupIndex) => {
      const slack = slackByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlacks))
        .minus(sum(...(flowByMask.get(maskKey) ?? [])))
        .eq(0),
      `mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const sharedOperationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsBySharedEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundBySharedEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `sop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `shared_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `shared_usage_${edgeIndex}`,
      )
      sharedOperationVars.push(operation)
    },
  )

  model.minimize(
    sum(...sharedOperationVars, ...localOperationTerms),
  )

  return {
    model,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
    groupCount: groups.length,
    classVariableCount,
    localOperationVariableCount,
    sharedOperationEdgeCount: sharedOperationVars.length,
    collapsedRecipeCount,
  }
}

async function solveBounded(
  model: Model,
  timeLimitSeconds: number,
): Promise<{
  status: string
  objective: number | null
  serializeMs: number
  parseMs: number
  solveMs: number
  namedSolution: Map<string, number> | null
}> {
  const serializeStartedAt = performance.now()
  const mps = model.print('mps')
  const serializeMs = performance.now() - serializeStartedAt
  const highs = await HiGHS.create()

  try {
    const parseStartedAt = performance.now()
    await highs.parse(mps, 'mps')
    const parseMs = performance.now() - parseStartedAt
    highs.setParam('time_limit', timeLimitSeconds)

    const solveStartedAt = performance.now()
    const solution = await highs.solve()
    const solveMs = performance.now() - solveStartedAt

    return {
      status: solution.status,
      objective:
        typeof solution.objective === 'number' &&
        Number.isFinite(solution.objective)
          ? solution.objective
          : null,
      serializeMs,
      parseMs,
      solveMs,
      namedSolution:
        solution.solution instanceof Map
          ? solution.solution
          : null,
    }
  } finally {
    highs.free()
  }
}


function buildServiceMaskCompressedNonfinalStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const customerFlowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(
    [...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]),
  )
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `ny_${customerIndex}_${maskIndex}`,
          )
          customerFlowVariableCount += 1
          customerTerms.push(y)
          customerFlowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `nonfinal_customer_${customerIndex}`,
      )
    },
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<
    number,
    ReturnType<typeof sum>
  >()
  const slackVarsByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackVars: ReturnType<Model['boolVar']>[] = []

  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const edgeKindByKey = new Map<string, 'through' | 'blending'>()

  let classVariableCount = 0
  let collapsedRecipeCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        edges: Array<{
          edgeKey: string
          kind: 'through' | 'blending'
          multiplicity: number
        }>
      }
    >()

    for (const recipe of group.recipes) {
      const edgeMultiplicities = new Map<
        string,
        {
          kind: 'through' | 'blending'
          multiplicity: number
        }
      >()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'finalizing') continue
        const kind =
          edge.kind === 'blending' ? 'blending' : 'through'
        const current = edgeMultiplicities.get(edge.key)
        edgeMultiplicities.set(edge.key, {
          kind,
          multiplicity: (current?.multiplicity ?? 0) + 1,
        })
      }

      const edges = [...edgeMultiplicities.entries()]
        .map(([edgeKey, value]) => ({
          edgeKey,
          kind: value.kind,
          multiplicity: value.multiplicity,
        }))
        .sort((left, right) =>
          left.edgeKey.localeCompare(right.edgeKey),
        )
      const signature = JSON.stringify(edges)
      if (!classes.has(signature)) {
        classes.set(signature, { edges })
      }
    }

    collapsedRecipeCount += group.recipes.length - classes.size

    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `nx_${classVariableCount}`,
      )
      classVariableCount += 1
      groupProductionVars.push(x)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      for (const edge of recipeClass.edges) {
        const terms = quantityTermsByEdgeKey.get(edge.edgeKey)
        const term = x.times(edge.multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edge.edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edge.edgeKey,
          (quantityUpperBoundByEdgeKey.get(edge.edgeKey) ?? 0) +
            groupUpperBound * edge.multiplicity,
        )
        const existingKind = edgeKindByKey.get(edge.edgeKey)
        if (existingKind && existingKind !== edge.kind) {
          throw new Error(
            `Machine edge ${edge.edgeKey} changed kind across recipes`,
          )
        }
        edgeKindByKey.set(edge.edgeKey, edge.kind)
      }
    }

    const groupProduction = sum(...groupProductionVars)
    groupProductionByIndex.set(groupIndex, groupProduction)

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`nslack_${groupIndex}`)
      slackVars.push(slack)
      slackVarsByGroupIndex.set(groupIndex, slack)
      model.addConstraint(
        slack.minus(groupProduction).leq(0),
        `nonfinal_slack_requires_production_${groupIndex}`,
      )
    }
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlackVars = groupIndexes.flatMap((groupIndex) => {
      const slack = slackVarsByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlackVars))
        .minus(sum(...(customerFlowByMask.get(maskKey) ?? [])))
        .eq(0),
      `nonfinal_mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'nonfinal_global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'nonfinal_production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'nonfinal_production_cost_fix',
  )

  const throughOps: ReturnType<Model['intVar']>[] = []
  const blendingOps: ReturnType<Model['intVar']>[] = []

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `nop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `nonfinal_op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `nonfinal_op_usage_${edgeIndex}`,
      )
      if (edgeKindByKey.get(edgeKey) === 'blending') {
        blendingOps.push(operation)
      } else {
        throughOps.push(operation)
      }
    },
  )

  const through = sum(...throughOps)
  const blending = sum(...blendingOps)
  model.addConstraint(
    through.geq(38),
    'nonfinal_through_lower_bound',
  )
  model.addConstraint(
    blending.geq(35),
    'nonfinal_blending_lower_bound',
  )
  model.minimize(through.plus(blending))

  return {
    model,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
    groupCount: groups.length,
    classVariableCount,
    collapsedRecipeCount,
    singletonSlackVariableCount: slackVars.length,
    throughOperationEdgeCount: throughOps.length,
    blendingOperationEdgeCount: blendingOps.length,
  }
}

profileIt(
  'proves the finalizing-30 frontier by exact extra-unit partition cases',
  async () => {
    const domain = canonicalDomain()
    const cases = [
      { pattern: '5', thresholds: [1, 1, 1, 1] as const },
      { pattern: '4+1', thresholds: [2, 1, 1, 1] as const },
      { pattern: '3+2', thresholds: [2, 2, 1, 0] as const },
      { pattern: '3+1+1', thresholds: [3, 1, 1, 0] as const },
      { pattern: '2+2+1', thresholds: [3, 2, 0, 0] as const },
      { pattern: '2+1+1+1', thresholds: [4, 1, 0, 0] as const },
      { pattern: '1+1+1+1+1', thresholds: [5, 0, 0, 0] as const },
    ]

    const results = []
    for (const extraCase of cases) {
      const buildStartedAt = performance.now()
      const built = buildFinalizing30CompressedFrontierStage(
        domain,
        extraCase.thresholds,
      )
      const buildMs = performance.now() - buildStartedAt
      const solved = await solveBoundedWithProgress(
        built.model,
        30,
      )

      const result = {
        pattern: extraCase.pattern,
        thresholds: extraCase.thresholds,
        targetFor107Certificate: 77,
        finalizingExact: 30,
        knownFullWitness: 107,
        serviceMaskCount: built.serviceMaskCount,
        customerFlowVariableCount:
          built.customerFlowVariableCount,
        groupCount: built.groupCount,
        classVariableCount: built.classVariableCount,
        classUseVariableCount: built.classUseVariableCount,
        sharedBlendEdgeCount: built.sharedBlendEdgeCount,
        sharedBlendOperationEdgeCount:
          built.sharedBlendOperationEdgeCount,
        privateBlendOperationTermCount:
          built.privateBlendOperationTermCount,
        throughOperationEdgeCount:
          built.throughOperationEdgeCount,
        maxPrivateBlendMultiplicity:
          built.maxPrivateBlendMultiplicity,
        extraThresholdVariableCount:
          built.extraThresholdVariableCount,
        buildMs: Math.round(buildMs),
        status: solved.status,
        nonFinalObjective: solved.objective,
        solveMs: Math.round(solved.solveMs),
        progressTail: solved.progressTail,
      }
      results.push(result)
      console.info(
        '[machine-extra-partition-case]',
        JSON.stringify(result),
      )
    }

    console.info(
      '[machine-extra-partition-summary]',
      JSON.stringify(results.map((result) => ({
        pattern: result.pattern,
        status: result.status,
        nonFinalObjective: result.nonFinalObjective,
        solveMs: result.solveMs,
      }))),
    )
  },
  260000,
)
