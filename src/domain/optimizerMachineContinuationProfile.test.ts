import { HiGHS, Model, sum } from '@bubblyworld/highs-ts'
import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import type { ProductionStepKind } from './productionPlan'

const PRODUCTION_UNITS_FIX = 35
const ASSIGNED_INGREDIENT_COST_FIX = 3853
const PRODUCTION_COST_FIX = 1948
const GLOBAL_SERVING_SLACK =
  PRODUCTION_UNITS_FIX * 2 - 69
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

function buildAssignmentFreeMachineLowerBound(
  domain: BatchOptimizationModel,
  kinds: ReadonlySet<ProductionStepKind>,
) {
  if (GLOBAL_SERVING_SLACK !== 1) {
    throw new Error('Profiler expects exactly one global slack serving')
  }

  const model = new Model()
  const xByRecipeId = new Map<string, ReturnType<Model['intVar']>>()
  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonCostRecipeTerms: ReturnType<Model['intVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()

  domain.recipes.forEach((recipe, recipeIndex) => {
    const customerCapacityUpperBound = Math.max(
      0,
      Math.ceil(recipe.eligibleCustomerIds.length / 2),
    )
    const recipeUpperBound = Math.min(
      PRODUCTION_UNITS_FIX,
      customerCapacityUpperBound,
      recipe.maxProductionUnits === undefined
        ? customerCapacityUpperBound
        : Math.max(0, Math.floor(recipe.maxProductionUnits)),
    )
    const x = model.intVar(
      0,
      recipeUpperBound,
      `x_${recipeIndex}`,
    )
    xByRecipeId.set(recipe.candidate.id, x)
    productionUnitTerms.push(x)
    productionCostTerms.push(
      x.times(recipe.juiceUnitIngredientCost),
    )
    if (
      recipe.juiceUnitIngredientCost === SINGLETON_RECIPE_COST
    ) {
      singletonCostRecipeTerms.push(x)
    }

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
        (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
          recipeUpperBound * multiplicity,
      )
    }
  })

  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  if (singletonCostRecipeTerms.length === 0) {
    throw new Error(
      `No recipe can carry the required singleton cost ${SINGLETON_RECIPE_COST}`,
    )
  }
  model.addConstraint(
    sum(...singletonCostRecipeTerms)
      .times(-1)
      .leq(-1),
    'required_singleton_cost_recipe',
  )

  const operationByEdgeKey = new Map<
    string,
    ReturnType<Model['intVar']>
  >()
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, quantityTerms], edgeIndex) => {
      const operationUpperBound = Math.max(
        1,
        Math.ceil(
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
            PROCESSING_STACK_CAPACITY,
        ),
      )
      const operation = model.intVar(
        0,
        operationUpperBound,
        `op_${edgeIndex}`,
      )
      operationByEdgeKey.set(edgeKey, operation)
      const quantity = sum(...quantityTerms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `operation_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `operation_usage_${edgeIndex}`,
      )
    },
  )

  model.minimize(sum(...operationByEdgeKey.values()))

  return {
    model,
    xByRecipeId,
    operationByEdgeKey,
    singletonCostRecipeCount:
      domain.recipes.filter(
        (recipe) =>
          recipe.juiceUnitIngredientCost === SINGLETON_RECIPE_COST,
      ).length,
  }
}

async function solveBounded(
  model: Model,
  timeLimitSeconds = 15,
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
  'profiles assignment-free exact machine lower bounds after the three fixed optima',
  async () => {
    const domain = canonicalDomain()

    expect(domain.recipes).toHaveLength(7892)
    expect(domain.serviceableCustomerIds).toHaveLength(69)
    expect(GLOBAL_SERVING_SLACK).toBe(1)
    expect(SINGLETON_RECIPE_COST).toBe(43)
    expect(
      domain.recipes.every(
        (recipe) => (recipe.initialFinishedServings ?? 0) === 0,
      ),
    ).toBe(true)

    const partitions: Array<{
      name: string
      kinds: ReadonlySet<ProductionStepKind>
    }> = [
      {
        name: 'throughSeasoning',
        kinds: new Set(['juicing', 'seasoning']),
      },
      {
        name: 'blending',
        kinds: new Set(['blending']),
      },
      {
        name: 'combinedNonfinal',
        kinds: new Set(['juicing', 'seasoning', 'blending']),
      },
    ]

    for (const partition of partitions) {
      const buildStartedAt = performance.now()
      const built = buildAssignmentFreeMachineLowerBound(
        domain,
        partition.kinds,
      )
      const buildMs = performance.now() - buildStartedAt
      const solved = await solveBounded(built.model)

      console.info(
        '[machine-assignment-free-lower-bound]',
        JSON.stringify({
          name: partition.name,
          buildMs: Math.round(buildMs),
          recipeVariableCount: built.xByRecipeId.size,
          operationEdgeCount: built.operationByEdgeKey.size,
          singletonCost: SINGLETON_RECIPE_COST,
          singletonCostRecipeCount: built.singletonCostRecipeCount,
          serializeMs: Math.round(solved.serializeMs),
          parseMs: Math.round(solved.parseMs),
          solveMs: Math.round(solved.solveMs),
          status: solved.status,
          objective: solved.objective,
          totalWithFinalizing30:
            partition.name === 'combinedNonfinal' &&
            solved.objective !== null
              ? solved.objective + 30
              : null,
        }),
      )
    }
  },
  120000,
)
