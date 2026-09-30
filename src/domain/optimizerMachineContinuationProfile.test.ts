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
import type { ProductionStepKind } from './productionPlan'

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

function machineStructureKey(
  recipe: EligibleOptimizationRecipe,
): string {
  const counts = new Map<string, number>()
  for (const edge of recipe.productionPath.edges) {
    if (edge.kind === 'finalizing') continue
    const key =
      edge.kind === 'blending'
        ? 'blending'
        : `${edge.kind}:${edge.equipment}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}*${count}`)
    .join('\u001f')
}

function buildStructuredAssignmentMachineLowerBound(
  domain: BatchOptimizationModel,
  kinds: ReadonlySet<ProductionStepKind>,
) {
  if (GLOBAL_SERVING_SLACK !== 1) {
    throw new Error('Profiler expects exactly one global slack serving')
  }

  const model = new Model()
  const classes = new Map<
    string,
    {
      key: string
      cost: number
      recipeIds: string[]
      eligibleCustomerIds: Set<string>
    }
  >()

  for (const recipe of domain.recipes) {
    const cost = recipe.juiceUnitIngredientCost
    const key = `${cost}\u001d${machineStructureKey(recipe)}`
    const current = classes.get(key)
    if (current) {
      current.recipeIds.push(recipe.candidate.id)
      recipe.eligibleCustomerIds.forEach((customerId) =>
        current.eligibleCustomerIds.add(customerId),
      )
    } else {
      classes.set(key, {
        key,
        cost,
        recipeIds: [recipe.candidate.id],
        eligibleCustomerIds: new Set(recipe.eligibleCustomerIds),
      })
    }
  }

  const xByRecipeId = new Map<string, ReturnType<Model['intVar']>>()
  const recipeUpperBoundById = new Map<string, number>()
  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()

  domain.recipes.forEach((recipe, recipeIndex) => {
    const eligibleCount = recipe.eligibleCustomerIds.length
    const parityAwareCapacityUpperBound =
      recipe.juiceUnitIngredientCost === SINGLETON_RECIPE_COST
        ? Math.ceil(eligibleCount / 2)
        : Math.floor(eligibleCount / 2)
    const recipeUpperBound = Math.min(
      PRODUCTION_UNITS_FIX,
      Math.max(0, parityAwareCapacityUpperBound),
      recipe.maxProductionUnits === undefined
        ? Math.max(0, parityAwareCapacityUpperBound)
        : Math.max(0, Math.floor(recipe.maxProductionUnits)),
    )
    const x = model.intVar(
      0,
      recipeUpperBound,
      `x_${recipeIndex}`,
    )
    xByRecipeId.set(recipe.candidate.id, x)
    recipeUpperBoundById.set(recipe.candidate.id, recipeUpperBound)
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
        (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
          recipeUpperBound * multiplicity,
      )
    }
  })

  const assignmentVarsByClassKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(
    [...classes.keys()].map((key) => [key, []]),
  )
  const assignedCostTerms: ReturnType<
    ReturnType<Model['numVar']>['times']
  >[] = []

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      ;[...classes.values()].forEach((entry, classIndex) => {
        if (!entry.eligibleCustomerIds.has(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${classIndex}`,
        )
        customerTerms.push(y)
        assignmentVarsByClassKey.get(entry.key)!.push(y)
        assignedCostTerms.push(y.times(entry.cost))
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const singletonClassVars: ReturnType<Model['boolVar']>[] = []
  ;[...classes.values()].forEach((entry, classIndex) => {
    const classProductionUnits = sum(
      ...entry.recipeIds.map((recipeId) =>
        xByRecipeId.get(recipeId)!,
      ),
    )
    const assignedCustomers = sum(
      ...(assignmentVarsByClassKey.get(entry.key) ?? []),
    )

    if (entry.cost === SINGLETON_RECIPE_COST) {
      const singleton = model.boolVar(
        `singleton_class_${classIndex}`,
      )
      singletonClassVars.push(singleton)
      model.addConstraint(
        classProductionUnits
          .times(2)
          .minus(assignedCustomers)
          .minus(singleton)
          .eq(0),
        `class_capacity_${classIndex}`,
      )
    } else {
      model.addConstraint(
        classProductionUnits
          .times(2)
          .minus(assignedCustomers)
          .eq(0),
        `class_capacity_${classIndex}`,
      )
    }
  })

  if (singletonClassVars.length === 0) {
    throw new Error(
      `No structural class can carry singleton cost ${SINGLETON_RECIPE_COST}`,
    )
  }
  model.addConstraint(
    sum(...singletonClassVars).eq(1),
    'singleton_class_total',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...assignedCostTerms).eq(ASSIGNED_INGREDIENT_COST_FIX),
    'assigned_cost_fix',
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
    classCount: classes.size,
    assignmentVariableCount:
      [...assignmentVarsByClassKey.values()].reduce(
        (total, vars) => total + vars.length,
        0,
      ),
    singletonClassCount: singletonClassVars.length,
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
  'profiles cost and machine-structure assignment lower bounds after the three fixed optima',
  async () => {
    const domain = canonicalDomain()

    expect(domain.recipes).toHaveLength(7892)
    expect(domain.serviceableCustomerIds).toHaveLength(
      SERVICEABLE_CUSTOMER_COUNT,
    )
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
      const built = buildStructuredAssignmentMachineLowerBound(
        domain,
        partition.kinds,
      )
      const buildMs = performance.now() - buildStartedAt
      const solved = await solveBounded(built.model)

      console.info(
        '[machine-structured-assignment-lower-bound]',
        JSON.stringify({
          name: partition.name,
          buildMs: Math.round(buildMs),
          recipeVariableCount: built.xByRecipeId.size,
          operationEdgeCount: built.operationByEdgeKey.size,
          classCount: built.classCount,
          assignmentVariableCount: built.assignmentVariableCount,
          singletonCost: SINGLETON_RECIPE_COST,
          singletonClassCount: built.singletonClassCount,
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
