import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { optimizeBatchPlan } from './optimizer'
import { buildOptimizationModel, type OptimizationRequest } from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

// This is deliberately a canonical-data proxy, NOT the player's 72-customer
// saved request. The player's actual selection, priorities, stock and jar
// constraints are not available to this test.
const enabled =
  (globalThis as {
    process?: { env?: Record<string, string | undefined> }
  }).process?.env?.OPTIMIZER_DEV_72_PROXY === '1'

it.skipIf(!enabled)(
  'profiles a bounded 72-selected-customer canonical-data full HiGHS solve',
  async () => {
    expect(canonicalCustomers.length).toBeGreaterThanOrEqual(72)
    const customerIds = canonicalCustomers.map((item) => item.id).sort().slice(0, 72)
    const request: OptimizationRequest = {
      customerIds,
      currentProgress: 'liquid-blender-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 9999,
        'tranquil-fountain': 9999,
        'ibex-statue': 9999,
      },
      formalCustomerIds: customerIds,
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-waste',
      priorities: [
        'minimum-waste',
        'maximum-ingredient-cost',
        'minimum-machine-operations',
      ],
      materialSourceMode: 'normal',
      availableJuiceJarCount: 5,
    }
    const source = {
      customers: canonicalCustomers,
      candidatePool: buildRecipeCandidatePool(request.currentProgress),
    }
    const model = buildOptimizationModel(request, source)
    const edges = model.recipes.reduce(
      (count, recipe) => count + recipe.eligibleCustomerIds.length, 0,
    )
    console.info('[optimizer-dev-72-proxy] model', JSON.stringify({
      fixture: 'canonical-selected-72-proxy-not-player-request',
      selectedCustomers: customerIds.length,
      serviceableCustomers: model.serviceableCustomerIds.length,
      unresolvedCustomers: model.unresolvedCustomerIds.length,
      recipes: model.recipes.length,
      assignmentEdges: edges,
      priorities: request.priorities,
      progress: request.currentProgress,
      candidatePolicy: request.candidatePolicy,
      jars: request.availableJuiceJarCount,
    }))

    const startedAt = performance.now()
    try {
      const result = await optimizeBatchPlan(request, { source })
      console.info('[optimizer-dev-72-proxy] terminal', JSON.stringify({
        outcome: 'completed',
        elapsedMs: Math.round(performance.now() - startedAt),
        assignedCustomers: result.assignments.length,
        unresolvedCustomers: result.unresolvedCustomers.length,
        totalIngredientCost: result.totalIngredientCost,
        machineOperations: result.machineOperations.total,
      }))
      expect(result.assignedServings).toBe(result.assignments.length)
      expect(new Set(result.assignments.map((entry) => entry.customerId)).size)
        .toBe(result.assignments.length)
      expect(result.assignments.every((entry) => customerIds.includes(entry.customerId)))
        .toBe(true)
      expect(result.recipePlans.reduce(
        (total, recipe) => total + recipe.assignedServings, 0,
      )).toBe(result.assignedServings)
      expect(result.assignedServings).toBeGreaterThan(0)
    } catch (error) {
      console.info('[optimizer-dev-72-proxy] terminal', JSON.stringify({
        outcome: 'error',
        elapsedMs: Math.round(performance.now() - startedAt),
        errorType: error instanceof Error ? error.name : 'unknown',
      }))
      throw error
    }
  },
  540_000,
)
