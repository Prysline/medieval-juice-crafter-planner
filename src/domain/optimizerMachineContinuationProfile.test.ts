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
const CERTIFIED_THROUGH_SEASONING_RELAXED_LB = 26

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

function blendCount(
  recipe: EligibleOptimizationRecipe,
): 0 | 1 | 2 {
  const count = recipe.productionPath.edges.filter(
    (edge) => edge.kind === 'blending',
  ).length
  if (count < 0 || count > 2) {
    throw new Error(
      `Unexpected blend count ${count} for ${recipe.candidate.id}`,
    )
  }
  return count as 0 | 1 | 2
}

function finalBlendEdgesAreRecipeIdentityUnique(
  domain: BatchOptimizationModel,
): boolean {
  const seen = new Set<string>()

  for (const recipe of domain.recipes) {
    const blends = recipe.productionPath.edges.filter(
      (edge) => edge.kind === 'blending',
    )
    if (blends.length === 0) continue
    const finalBlend = blends.at(-1)
    if (!finalBlend) return false
    if (
      finalBlend.toIngredientIds.join('\u001f') !==
      recipe.productionPath.ingredientIds.join('\u001f')
    ) {
      return false
    }
    if (seen.has(finalBlend.key)) return false
    seen.add(finalBlend.key)
  }

  return true
}

interface AssignmentGroup {
  key: string
  eligibleCustomerIds: string[]
  ingredientCost: number
  availableBlendCounts: Set<0 | 1 | 2>
}

function assignmentGroups(
  domain: BatchOptimizationModel,
): AssignmentGroup[] {
  const groups = new Map<string, AssignmentGroup>()

  for (const recipe of domain.recipes) {
    const eligibleCustomerIds = [
      ...recipe.eligibleCustomerIds,
    ].sort()
    const ingredientCost = recipe.juiceUnitIngredientCost
    const key =
      `${eligibleCustomerIds.join('\u001e')}\u001d${ingredientCost}`
    const current = groups.get(key)
    if (current) {
      current.availableBlendCounts.add(blendCount(recipe))
    } else {
      groups.set(key, {
        key,
        eligibleCustomerIds,
        ingredientCost,
        availableBlendCounts: new Set([blendCount(recipe)]),
      })
    }
  }

  return [...groups.values()]
}

function addCeilOperation(
  model: Model,
  quantity: ReturnType<typeof sum>,
  upperBound: number,
  name: string,
) {
  const operation = model.intVar(
    0,
    Math.max(1, upperBound),
    name,
  )
  model.addConstraint(
    quantity
      .minus(operation.times(PROCESSING_STACK_CAPACITY))
      .leq(0),
    `${name}_capacity`,
  )
  model.addConstraint(
    operation.minus(quantity).leq(0),
    `${name}_usage`,
  )
  return operation
}

function buildUniqueTailLowerBound(
  domain: BatchOptimizationModel,
) {
  const groups = assignmentGroups(domain)
  const model = new Model()
  const assignmentVarsByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(
    groups.map((group) => [group.key, []]),
  )
  const assignedCostTerms: ReturnType<
    ReturnType<Model['numVar']>['times']
  >[] = []

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
        assignmentVarsByGroupKey.get(group.key)!.push(y)
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
  const singletonVars: ReturnType<Model['boolVar']>[] = []
  const finalizingOperationTerms: ReturnType<Model['intVar']>[] = []
  const finalBlendOperationTerms: ReturnType<Model['intVar']>[] = []
  const threeSegmentUnitTerms: ReturnType<Model['intVar']>[] = []
  let categoryVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const xByBlendCount = new Map<
      0 | 1 | 2,
      ReturnType<Model['intVar']>
    >()
    const upperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )

    for (const count of [0, 1, 2] as const) {
      if (!group.availableBlendCounts.has(count)) continue
      const x = model.intVar(
        0,
        upperBound,
        `x_${groupIndex}_b${count}`,
      )
      xByBlendCount.set(count, x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(group.ingredientCost),
      )
      categoryVariableCount += 1
      if (count === 2) threeSegmentUnitTerms.push(x)
    }

    const groupUnits = sum(...xByBlendCount.values())
    const assignedCustomers = sum(
      ...(assignmentVarsByGroupKey.get(group.key) ?? []),
    )

    if (group.ingredientCost === SINGLETON_RECIPE_COST) {
      const singleton = model.boolVar(
        `singleton_${groupIndex}`,
      )
      singletonVars.push(singleton)
      model.addConstraint(
        groupUnits
          .times(2)
          .minus(assignedCustomers)
          .minus(singleton)
          .eq(0),
        `group_capacity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupUnits
          .times(2)
          .minus(assignedCustomers)
          .eq(0),
        `group_capacity_${groupIndex}`,
      )
    }

    finalizingOperationTerms.push(
      addCeilOperation(
        model,
        groupUnits,
        upperBound,
        `finish_op_${groupIndex}`,
      ),
    )

    const blendedUnits = sum(
      ...[1, 2].flatMap((count) => {
        const variable = xByBlendCount.get(count as 1 | 2)
        return variable ? [variable] : []
      }),
    )
    if (xByBlendCount.has(1) || xByBlendCount.has(2)) {
      finalBlendOperationTerms.push(
        addCeilOperation(
          model,
          blendedUnits,
          upperBound,
          `final_blend_op_${groupIndex}`,
        ),
      )
    }
  })

  model.addConstraint(
    sum(...singletonVars).eq(1),
    'singleton_total',
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

  const firstBlendCollapsedOperation =
    addCeilOperation(
      model,
      sum(...threeSegmentUnitTerms),
      PRODUCTION_UNITS_FIX,
      'first_blend_collapsed_op',
    )

  model.minimize(
    sum(
      ...finalizingOperationTerms,
      ...finalBlendOperationTerms,
      firstBlendCollapsedOperation,
    ),
  )

  return {
    model,
    groupCount: groups.length,
    assignmentVariableCount:
      [...assignmentVarsByGroupKey.values()].reduce(
        (total, vars) => total + vars.length,
        0,
      ),
    categoryVariableCount,
    finalizingOperationCount:
      finalizingOperationTerms.length,
    finalBlendOperationCount:
      finalBlendOperationTerms.length,
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
  'profiles joint finalizing and unique final-blend lower bound',
  async () => {
    const domain = canonicalDomain()

    expect(domain.recipes).toHaveLength(7892)
    expect(domain.serviceableCustomerIds).toHaveLength(
      SERVICEABLE_CUSTOMER_COUNT,
    )
    expect(GLOBAL_SERVING_SLACK).toBe(1)
    expect(SINGLETON_RECIPE_COST).toBe(43)
    expect(
      finalBlendEdgesAreRecipeIdentityUnique(domain),
    ).toBe(true)

    const buildStartedAt = performance.now()
    const built = buildUniqueTailLowerBound(domain)
    const buildMs = performance.now() - buildStartedAt
    const solved = await solveBounded(built.model)

    console.info(
      '[machine-unique-tail-lower-bound]',
      JSON.stringify({
        buildMs: Math.round(buildMs),
        groupCount: built.groupCount,
        assignmentVariableCount: built.assignmentVariableCount,
        categoryVariableCount: built.categoryVariableCount,
        finalizingOperationCount:
          built.finalizingOperationCount,
        finalBlendOperationCount:
          built.finalBlendOperationCount,
        serializeMs: Math.round(solved.serializeMs),
        parseMs: Math.round(solved.parseMs),
        solveMs: Math.round(solved.solveMs),
        status: solved.status,
        uniqueTailObjective: solved.objective,
        totalWithThroughSeasoning26:
          solved.objective === null
            ? null
            : solved.objective +
              CERTIFIED_THROUGH_SEASONING_RELAXED_LB,
      }),
    )
  },
  120000,
)
