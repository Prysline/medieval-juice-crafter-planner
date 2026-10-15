import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { highsSolverAdapter } from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

declare const process: {
  env: Record<string, string | undefined>
}

const enabled = process.env.OPTIMIZER_PHASE_F_CANONICAL12_PROTOTYPE === '1'
const CUSTOMER_COUNT = 12
const EXPECTED_PREFIX = {
  productionUnits: 6,
  assignedIngredientCost: 678,
  productionCost: 339,
} as const
const EXPECTED_MACHINE_OPERATIONS = 24
const EXPECTED_RECIPE_KINDS = 6

function currentWorldRequest(customerCount: number): OptimizationRequest {
  const currentProgress = 'liquid-blender-unlocked'
  const availableCustomerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)
  const customerIds = availableCustomerIds.slice(0, customerCount)

  return {
    customerIds,
    currentProgress,
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 9999,
      'tranquil-fountain': 9999,
      'ibex-statue': 9999,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'allow-unambiguous-computed',
    objective: 'minimum-waste',
    priorities: ['minimum-waste', 'maximum-ingredient-cost'],
    availableJuiceJarCount: 5,
  }
}

function independentMetrics(
  domain: BatchOptimizationModel,
  solution: Awaited<ReturnType<typeof highsSolverAdapter.solve>>,
) {
  const recipeById = new Map(
    domain.recipes.map((recipe) => [recipe.candidate.id, recipe]),
  )
  const assignedCountByRecipeId = new Map<string, number>()
  let assignedIngredientCost = 0

  expect(solution.assignments).toHaveLength(CUSTOMER_COUNT)
  expect(new Set(solution.assignments.map((entry) => entry.customerId))).toEqual(
    new Set(domain.serviceableCustomerIds),
  )

  for (const assignment of solution.assignments) {
    const recipe = recipeById.get(assignment.recipeId)
    if (!recipe) {
      throw new Error(`Fallback returned unknown recipe ${assignment.recipeId}`)
    }
    expect(recipe.eligibleCustomerIds).toContain(assignment.customerId)
    assignedIngredientCost += recipe.juiceUnitIngredientCost
    assignedCountByRecipeId.set(
      assignment.recipeId,
      (assignedCountByRecipeId.get(assignment.recipeId) ?? 0) + 1,
    )
  }

  let productionUnits = 0
  let productionCost = 0
  const quantityByEdgeKey = new Map<string, number>()
  for (const recipe of domain.recipes) {
    const units = solution.productionUnitsByRecipeId[recipe.candidate.id] ?? 0
    if (units <= 0) continue
    productionUnits += units
    productionCost += units * recipe.juiceUnitIngredientCost
    for (const edge of recipe.productionPath.edges) {
      quantityByEdgeKey.set(
        edge.key,
        (quantityByEdgeKey.get(edge.key) ?? 0) + units,
      )
    }
  }

  for (const [recipeId, assignedCount] of assignedCountByRecipeId) {
    const recipe = recipeById.get(recipeId)
    if (!recipe) throw new Error(`Fallback capacity recipe missing: ${recipeId}`)
    const availableServings =
      (recipe.initialFinishedServings ?? 0) +
      (solution.productionUnitsByRecipeId[recipeId] ?? 0) * 2
    expect(assignedCount).toBeLessThanOrEqual(availableServings)
  }

  const machineOperations = [...quantityByEdgeKey.values()].reduce(
    (total, quantity) =>
      total + Math.ceil(quantity / PROCESSING_STACK_CAPACITY),
    0,
  )

  return {
    productionUnits,
    assignedIngredientCost,
    productionCost,
    machineOperations,
    recipeKinds: new Set(
      solution.assignments.map((assignment) => assignment.recipeId),
    ).size,
  }
}

describe.skipIf(!enabled)('Phase F canonical-12 generic exact fallback', () => {
  it(
    'matches the canonical full-domain authority through the current adapter',
    async () => {
      const request = currentWorldRequest(CUSTOMER_COUNT)
      const candidatePool = buildRecipeCandidatePool(request.currentProgress)
      const domain = buildOptimizationModel(request, {
        customers: canonicalCustomers,
        candidatePool,
      })

      const startedAt = performance.now()
      const solution = await highsSolverAdapter.solve(
        domain,
        ['minimum-waste', 'maximum-ingredient-cost'],
      )
      const wallMs = performance.now() - startedAt
      const metrics = independentMetrics(domain, solution)

      expect(metrics).toEqual({
        productionUnits: EXPECTED_PREFIX.productionUnits,
        assignedIngredientCost: EXPECTED_PREFIX.assignedIngredientCost,
        productionCost: EXPECTED_PREFIX.productionCost,
        machineOperations: EXPECTED_MACHINE_OPERATIONS,
        recipeKinds: EXPECTED_RECIPE_KINDS,
      })
      expect(solution.metrics.totalProductionUnits).toBe(
        EXPECTED_PREFIX.productionUnits,
      )
      expect(solution.metrics.totalIngredientCost).toBe(
        EXPECTED_PREFIX.productionCost,
      )
      expect(solution.metrics.machineOperations).toBe(
        EXPECTED_MACHINE_OPERATIONS,
      )
      expect(solution.metrics.recipeKinds).toBe(EXPECTED_RECIPE_KINDS)

      console.info(
        '[phase-f-canonical12-generic-fallback]',
        JSON.stringify({
          recipes: domain.recipes.length,
          assignments: solution.assignments.length,
          metrics,
          wallMs,
        }),
      )
    },
    300_000,
  )
})
