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
function buildFlowParityPartitionStage(
  domain: BatchOptimizationModel,
  kinds: ReadonlySet<ProductionStepKind>,
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

  const slackFlowVars: ReturnType<Model['numVar']>[] = []
  if (GLOBAL_SERVING_SLACK === 1) {
    groups.forEach((group, groupIndex) => {
      if (group.ingredientCost !== SLACK_RECIPE_COST) return

      const slack = model.numVar(
        0,
        1,
        `slack_${groupIndex}`,
      )
      slackFlowVars.push(slack)
      flowByGroupKey.get(group.key)!.push(slack)
    })
    model.addConstraint(
      sum(...slackFlowVars).eq(1),
      'virtual_slack_serving',
    )
  } else {
    expect(GLOBAL_SERVING_SLACK).toBe(0)
  }

  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
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
      const signature = partitionSignature(recipe, kinds)
      if (!signatures.has(signature.key)) {
        signatures.set(signature.key, signature)
      }
    }

    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const quotientVars: ReturnType<Model['intVar']>[] = []

    for (const signature of signatures.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `qx_${quotientVariableCount}`,
      )
      quotientVariableCount += 1
      quotientVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      for (
        const [edgeKey, multiplicity]
        of signature.multiplicityByEdgeKey
      ) {
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

    model.addConstraint(
      sum(...(flowByGroupKey.get(group.key) ?? []))
        .minus(sum(...quotientVars).times(2))
        .eq(0),
      `group_flow_${groupIndex}`,
    )
  })

  // Redundant with total real + virtual flow, retained as a proof guard.
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
    ([edgeKey, quantityTerms], edgeIndex) => {
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
      const quantity = sum(...quantityTerms)
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
    groupCount: groups.length,
    customerFlowVariableCount,
    slackFlowVariableCount: slackFlowVars.length,
    quotientVariableCount,
    operationEdgeCount: operationVars.length,
  }
}


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

async function solveBounded(
  model: Model,
  timeLimitSeconds: number,
): Promise<{
  status: string
  objective: number | null
  serializeMs: number
  parseMs: number
  solveMs: number
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
    }
  } finally {
    highs.free()
  }
}

profileIt(
  'lifts the exact through-seasoning-optimal pairing into a full-machine witness',
  async () => {
    const domain = canonicalDomain()
    expect(domain.recipes).toHaveLength(7892)
    expect(domain.serviceableCustomerIds).toHaveLength(
      SERVICEABLE_CUSTOMER_COUNT,
    )

    const partitionBuilt = buildPartitionOptimalPairStage(
      domain,
      new Set<ProductionStepKind>(['juicing', 'seasoning']),
    )
    const partitionStartedAt = performance.now()
    const partitionSolution = await partitionBuilt.model.solve()
    const partitionSolveMs =
      performance.now() - partitionStartedAt
    if (partitionSolution.status !== 'optimal') {
      throw new Error(
        `Through-seasoning pairing ended with ${partitionSolution.status}`,
      )
    }

    const unitsByGroupKey = new Map<string, number>()
    for (const group of partitionBuilt.groups) {
      let units = 0
      for (const variable of (
        partitionBuilt.unitVarsByGroupKey.get(group.key) ?? []
      )) {
        const value = partitionSolution.getValue(variable)
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(
            'Invalid through-seasoning pair variable value',
          )
        }
        if (value > 0.5) units += 1
      }
      unitsByGroupKey.set(group.key, units)
    }

    const fullBuilt = buildFixedGroupFullMachineStage(
      domain,
      unitsByGroupKey,
    )
    const fullStartedAt = performance.now()
    const fullSolution = await fullBuilt.model.solve()
    const fullSolveMs = performance.now() - fullStartedAt
    if (fullSolution.status !== 'optimal') {
      throw new Error(
        `Full-machine lift ended with ${fullSolution.status}`,
      )
    }

    const selections = domain.recipes.flatMap((recipe) => {
      const variable = fullBuilt.xByRecipeId.get(recipe.candidate.id)
      if (!variable) return []
      const value = fullSolution.getValue(variable)
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Invalid full-machine recipe variable value')
      }
      const units = Math.round(value)
      return units > 0
        ? [{ recipeId: recipe.candidate.id, units }]
        : []
    })
    const breakdown = machineOperationBreakdownForSelection(
      domain,
      selections,
    )

    console.info(
      '[machine-through-optimal-witness]',
      JSON.stringify({
        throughObjective: partitionSolution.objective,
        throughSolveMs: Math.round(partitionSolveMs),
        quotientVariableCount:
          partitionBuilt.quotientVariableCount,
        throughEdgeCount: partitionBuilt.operationEdgeCount,
        selectedGroupCount: fullBuilt.selectedGroupCount,
        fullRecipeVariableCount: fullBuilt.recipeVariableCount,
        fullOperationEdgeCount: fullBuilt.operationEdgeCount,
        fullSolveMs: Math.round(fullSolveMs),
        selectedRecipeCount: selections.length,
        breakdown,
        globalLowerBound: 103,
        bestKnownUpperBound: 107,
      }),
    )
  },
  120000,
)

