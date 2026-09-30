import { HiGHS, Model, sum } from '@bubblyworld/highs-ts'
import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
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
  expect(Math.round(solution.objective)).toBe(PRODUCTION_UNITS_FIX)

  const unitsByGroupKey = new Map(
    groups.map((group) => [
      group.key,
      (unitVarsByGroupKey.get(group.key) ?? []).reduce(
        (total, variable) =>
          total + (solution.getValue(variable) > 0.5 ? 1 : 0),
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
  'profiles exact recipe identity choice for one cost-optimal pair matching',
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

    const buildStartedAt = performance.now()
    const built = buildFixedGroupMachineStage(
      domain,
      pairing.unitsByGroupKey,
    )
    const buildMs = performance.now() - buildStartedAt
    const solved = await solveBounded(built.model)

    console.info(
      '[machine-fixed-pair-groups]',
      JSON.stringify({
        pairFeasibilitySolveMs: Math.round(pairing.solveMs),
        selectedGroupCount: built.selectedGroupCount,
        recipeVariableCount: built.recipeVariableCount,
        operationEdgeCount: built.operationEdgeCount,
        machineBuildMs: Math.round(buildMs),
        serializeMs: Math.round(solved.serializeMs),
        parseMs: Math.round(solved.parseMs),
        solveMs: Math.round(solved.solveMs),
        status: solved.status,
        objective: solved.objective,
      }),
    )
  },
  120000,
)
