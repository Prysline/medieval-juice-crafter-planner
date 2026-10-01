import { HiGHS, Model, sum } from '@bubblyworld/highs-ts'
import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { machineOperationBreakdownForSelection } from './optimizerCertificates'
import type { ProductionStepKind } from './productionPlan'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'

const PRODUCTION_UNITS_FIX = 35
const ASSIGNED_INGREDIENT_COST_FIX = 3853
const PRODUCTION_COST_FIX = 1948
const SERVICEABLE_CUSTOMER_COUNT = 69
const GLOBAL_SERVING_SLACK =
  PRODUCTION_UNITS_FIX * 2 - SERVICEABLE_CUSTOMER_COUNT
const SINGLETON_RECIPE_COST =
  PRODUCTION_COST_FIX * 2 - ASSIGNED_INGREDIENT_COST_FIX

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

async function findCostOptimalPairFeasibility(
  domain: BatchOptimizationModel,
): Promise<{
  unitsByGroupKey: Map<string, number>
  solveMs: number
}> {
  const groups = pairGroups(domain)
  const model = new Model()
  const coverageByCustomerId = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(
    domain.serviceableCustomerIds.map((customerId) => [
      customerId,
      [],
    ]),
  )
  const unitVarsByGroupKey = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(
    groups.map((group) => [group.key, []]),
  )
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
    if (group.ingredientCost === SINGLETON_RECIPE_COST) {
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
        sum(...(coverageByCustomerId.get(customerId) ?? []))
          .eq(1),
        `cover_${customerIndex}`,
      )
    },
  )
  model.addConstraint(
    sum(...singletonVars).eq(1),
    'singleton_total',
  )
  model.addConstraint(
    sum(...allUnitVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...assignedCostTerms).eq(ASSIGNED_INGREDIENT_COST_FIX),
    'assigned_cost_fix',
  )
  // The fixed assigned cost plus the unique cost-43 singleton imply
  // production cost (3853 + 43) / 2 = 1948 exactly. Keep the
  // objective constant so this stage is pure feasibility.
  model.minimize(sum(...allUnitVars))

  const startedAt = performance.now()
  const solution = await model.solve()
  const solveMs = performance.now() - startedAt
  if (solution.status !== 'optimal') {
    throw new Error(
      `Cost-optimal pair feasibility ended with ${solution.status}`,
    )
  }
  const objective = solution.objective
  if (typeof objective !== 'number' || !Number.isFinite(objective)) {
    throw new Error('Pair feasibility returned a non-finite objective')
  }
  expect(Math.round(objective)).toBe(PRODUCTION_UNITS_FIX)

  const unitsByGroupKey = new Map(
    groups.map((group) => [
      group.key,
      (unitVarsByGroupKey.get(group.key) ?? []).reduce(
        (total, variable) =>
          (() => {
            const value = solution.getValue(variable)
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              throw new Error('Pair feasibility returned a non-finite variable value')
            }
            return total + (value > 0.5 ? 1 : 0)
          })(),
        0,
      ),
    ]),
  )
  const productionCost = groups.reduce(
    (total, group) =>
      total +
      (unitsByGroupKey.get(group.key) ?? 0) *
        group.ingredientCost,
    0,
  )
  expect(productionCost).toBe(PRODUCTION_COST_FIX)

  return { unitsByGroupKey, solveMs }
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
      .map(([edgeKey, multiplicity]) => `${edgeKey}*${multiplicity}`)
      .join('\u001f'),
    multiplicityByEdgeKey,
  }
}

function buildPairLiftedPartitionQuotientStage(
  domain: BatchOptimizationModel,
  kinds: ReadonlySet<ProductionStepKind>,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const coverageByCustomerId = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(
    domain.serviceableCustomerIds.map((customerId) => [
      customerId,
      [],
    ]),
  )
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

  let pairVariableCount = 0
  let singletonVariableCount = 0
  groups.forEach((group, groupIndex) => {
    if (group.ingredientCost === SINGLETON_RECIPE_COST) {
      group.eligibleCustomerIds.forEach(
        (customerId, customerIndex) => {
          const singleton = model.boolVar(
            `single_${groupIndex}_${customerIndex}`,
          )
          singletonVariableCount += 1
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
        pairVariableCount += 1
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
        sum(...(coverageByCustomerId.get(customerId) ?? []))
          .eq(1),
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
      productionCostTerms.push(x.times(group.ingredientCost))

      for (const [edgeKey, multiplicity] of signature.multiplicityByEdgeKey) {
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
    groupCount: groups.length,
    pairVariableCount,
    singletonVariableCount,
    quotientVariableCount,
    operationEdgeCount: operationVars.length,
  }
}

function buildPairLiftedMachineStage(
  domain: BatchOptimizationModel,
  machineOperationKinds?: ReadonlySet<ProductionStepKind>,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const coverageByCustomerId = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(
    domain.serviceableCustomerIds.map((customerId) => [
      customerId,
      [],
    ]),
  )
  const unitVarsByGroupKey = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(
    groups.map((group) => [group.key, []]),
  )
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

  let pairVariableCount = 0
  let singletonVariableCount = 0

  groups.forEach((group, groupIndex) => {
    if (group.ingredientCost === SINGLETON_RECIPE_COST) {
      group.eligibleCustomerIds.forEach(
        (customerId, customerIndex) => {
          const singleton = model.boolVar(
            `single_${groupIndex}_${customerIndex}`,
          )
          singletonVariableCount += 1
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
        pairVariableCount += 1
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
        sum(...(coverageByCustomerId.get(customerId) ?? []))
          .eq(1),
        `cover_${customerIndex}`,
      )
    },
  )
  model.addConstraint(
    sum(...singletonVars).eq(1),
    'singleton_total',
  )
  model.addConstraint(
    sum(...allUnitVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...assignedCostTerms).eq(ASSIGNED_INGREDIENT_COST_FIX),
    'assigned_cost_fix',
  )

  const xByRecipeId = new Map<string, ReturnType<Model['intVar']>>()
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()

  let recipeVariableIndex = 0
  groups.forEach((group, groupIndex) => {
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []
    const groupUnitUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUnitUpperBound,
        `x_${recipeVariableIndex}`,
      )
      recipeVariableIndex += 1
      xByRecipeId.set(recipe.candidate.id, x)
      groupRecipeVars.push(x)

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (
          machineOperationKinds &&
          !machineOperationKinds.has(edge.kind)
        ) {
          continue
        }
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
            groupUnitUpperBound * multiplicity,
        )
      }
    }

    model.addConstraint(
      sum(...groupRecipeVars)
        .minus(sum(...(unitVarsByGroupKey.get(group.key) ?? [])))
        .eq(0),
      `group_recipe_units_${groupIndex}`,
    )
  })

  const productionCostTerms = groups.flatMap((group) =>
    group.recipes.map((recipe) =>
      xByRecipeId
        .get(recipe.candidate.id)!
        .times(recipe.juiceUnitIngredientCost),
    ),
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationByEdgeKey = new Map<
    string,
    ReturnType<Model['intVar']>
  >()
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
      operationByEdgeKey.set(edgeKey, operation)
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
    },
  )

  model.minimize(sum(...operationByEdgeKey.values()))

  return {
    model,
    groupCount: groups.length,
    pairVariableCount,
    singletonVariableCount,
    recipeVariableCount: xByRecipeId.size,
    operationEdgeCount: operationByEdgeKey.size,
  }
}

function buildFixedGroupMachineStage(
  domain: BatchOptimizationModel,
  unitsByGroupKey: Map<string, number>,
) {
  const groups = pairGroups(domain)
    .filter((group) => (unitsByGroupKey.get(group.key) ?? 0) > 0)
  const model = new Model()
  const xByRecipeId = new Map<string, ReturnType<Model['intVar']>>()
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()

  let recipeVariableIndex = 0
  for (const group of groups) {
    const groupUnits = unitsByGroupKey.get(group.key) ?? 0
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUnits,
        `x_${recipeVariableIndex}`,
      )
      recipeVariableIndex += 1
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

  const operationByEdgeKey = new Map<
    string,
    ReturnType<Model['intVar']>
  >()
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
      operationByEdgeKey.set(edgeKey, operation)
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
    },
  )

  model.minimize(sum(...operationByEdgeKey.values()))

  return {
    model,
    selectedGroupCount: groups.length,
    recipeVariableCount: xByRecipeId.size,
    operationEdgeCount: operationByEdgeKey.size,
    xByRecipeId,
  }
}

async function solveBounded(
  model: Model,
  timeLimitSeconds = 20,
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

it(
  'profiles exact partition bounds after pair-parity lifting',
  async () => {
    const domain = canonicalDomain()

    expect(domain.recipes).toHaveLength(7892)
    expect(domain.serviceableCustomerIds).toHaveLength(
      SERVICEABLE_CUSTOMER_COUNT,
    )
    expect(GLOBAL_SERVING_SLACK).toBe(1)
    expect(SINGLETON_RECIPE_COST).toBe(43)

    const pairing =
      await findCostOptimalPairFeasibility(domain)

    const witnessBuildStartedAt = performance.now()
    const witnessBuilt = buildFixedGroupMachineStage(
      domain,
      pairing.unitsByGroupKey,
    )
    const witnessBuildMs =
      performance.now() - witnessBuildStartedAt
    const witnessSolveStartedAt = performance.now()
    const witnessSolution = await witnessBuilt.model.solve()
    const witnessSolveMs =
      performance.now() - witnessSolveStartedAt
    if (witnessSolution.status !== 'optimal') {
      throw new Error(
        `Fixed-pair witness ended with ${witnessSolution.status}`,
      )
    }

    const witnessSelections = domain.recipes.flatMap((recipe) => {
      const variable = witnessBuilt.xByRecipeId.get(
        recipe.candidate.id,
      )
      if (!variable) return []
      const value = witnessSolution.getValue(variable)
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `Fixed-pair witness returned invalid x for ${recipe.candidate.id}`,
        )
      }
      const units = Math.round(value)
      return units > 0
        ? [{ recipeId: recipe.candidate.id, units }]
        : []
    })
    const witnessBreakdown =
      machineOperationBreakdownForSelection(
        domain,
        witnessSelections,
      )

    console.info(
      '[machine-fixed-pair-witness]',
      JSON.stringify({
        pairFeasibilitySolveMs: Math.round(pairing.solveMs),
        selectedGroupCount: witnessBuilt.selectedGroupCount,
        recipeVariableCount: witnessBuilt.recipeVariableCount,
        operationEdgeCount: witnessBuilt.operationEdgeCount,
        buildMs: Math.round(witnessBuildMs),
        solveMs: Math.round(witnessSolveMs),
        recipeCount: witnessSelections.length,
        breakdown: witnessBreakdown,
      }),
    )

    const partitions: Array<{
      name: 'throughSeasoning' | 'blending'
      kinds: ReadonlySet<ProductionStepKind>
      timeLimitSeconds: number
    }> = [
      {
        name: 'blending',
        kinds: new Set<ProductionStepKind>(['blending']),
        timeLimitSeconds: 60,
      },
    ]

    const lowerBounds: Record<
      'throughSeasoning' | 'blending',
      number | null
    > = {
      throughSeasoning: null,
      blending: null,
    }

    for (const partition of partitions) {
      const buildStartedAt = performance.now()
      const built = buildPairLiftedMachineStage(
        domain,
        partition.kinds,
      )
      const buildMs = performance.now() - buildStartedAt
      const solved = await solveBounded(
        built.model,
        partition.timeLimitSeconds,
      )
      lowerBounds[partition.name] =
        solved.status === 'optimal'
          ? solved.objective
          : null

      console.info(
        '[machine-pair-lifted-partition]',
        JSON.stringify({
          name: partition.name,
          groupCount: built.groupCount,
          pairVariableCount: built.pairVariableCount,
          singletonVariableCount: built.singletonVariableCount,
          recipeVariableCount: built.recipeVariableCount,
          operationEdgeCount: built.operationEdgeCount,
          buildMs: Math.round(buildMs),
          serializeMs: Math.round(solved.serializeMs),
          parseMs: Math.round(solved.parseMs),
          solveMs: Math.round(solved.solveMs),
          status: solved.status,
          objective: solved.objective,
        }),
      )
    }

    const throughKinds = new Set<ProductionStepKind>([
      'juicing',
      'seasoning',
    ])
    const quotientBuildStartedAt = performance.now()
    const quotient = buildPairLiftedPartitionQuotientStage(
      domain,
      throughKinds,
    )
    const quotientBuildMs =
      performance.now() - quotientBuildStartedAt
    const quotientSolved = await solveBounded(
      quotient.model,
      75,
    )
    lowerBounds.throughSeasoning =
      quotientSolved.status === 'optimal'
        ? quotientSolved.objective
        : null

    console.info(
      '[machine-pair-lifted-quotient]',
      JSON.stringify({
        name: 'throughSeasoning',
        groupCount: quotient.groupCount,
        pairVariableCount: quotient.pairVariableCount,
        singletonVariableCount: quotient.singletonVariableCount,
        quotientVariableCount: quotient.quotientVariableCount,
        operationEdgeCount: quotient.operationEdgeCount,
        buildMs: Math.round(quotientBuildMs),
        serializeMs: Math.round(quotientSolved.serializeMs),
        parseMs: Math.round(quotientSolved.parseMs),
        solveMs: Math.round(quotientSolved.solveMs),
        status: quotientSolved.status,
        objective: quotientSolved.objective,
      }),
    )

    console.info(
      '[machine-partition-certificate-check]',
      JSON.stringify({
        lowerBounds: {
          ...lowerBounds,
          finalizing: 30,
        },
        lowerBoundTotal:
          lowerBounds.throughSeasoning !== null &&
          lowerBounds.blending !== null
            ? lowerBounds.throughSeasoning +
              lowerBounds.blending +
              30
            : null,
        witnessBreakdown,
      }),
    )
  },
  240000,
)

