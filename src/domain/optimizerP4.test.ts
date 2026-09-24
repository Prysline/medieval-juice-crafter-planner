import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import type { Customer, RecipeCandidate } from '../types'
import { optimizeBatchPlan } from './optimizer'
import { highsSolverAdapter } from './optimizerHighsSolver'
import type {
  BatchOptimizationModel,
  EligibleOptimizationRecipe,
  OptimizationRequest,
} from './optimizerModel'

function customer(id: string, preference: string): Customer {
  return {
    id,
    name: id.toUpperCase(),
    occupation: '測試',
    villageId: 'east-harbor',
    satisfactionRequired: 0,
    preferences: [{ kind: 'effect', value: preference }],
  }
}

function recipe(
  id: string,
  ingredients: string[],
  effects: string[],
): RecipeCandidate {
  return {
    id,
    name: id,
    source: 'observed',
    unlockedAt: 'seasoner-unlocked',
    salePrice: 10,
    ingredients,
    effects: effects.map((name, index) => ({
      name,
      value: 5 - index,
    })),
    equipment: [],
  }
}

function baseRequest(
  customerIds: string[],
): OptimizationRequest {
  return {
    customerIds,
    currentProgress: 'seasoner-unlocked',
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'observed-only',
    objective: 'minimum-cost',
  }
}

function fallbackRecipe(
  id: string,
  kind: 'juicing' | 'finalizing',
): EligibleOptimizationRecipe {
  return {
    candidate: {
      id,
      name: id,
      source: 'observed',
      unlockedAt: 'opening',
      salePrice: 10,
      ingredients: ['檸檬'],
      effects: [{ name: '酸味', value: 4 }],
      equipment: [],
    },
    juiceUnitIngredientCost: 1,
    eligibleCustomerIds: ['a'],
    productionPath: {
      ingredientIds: ['lemon'],
      edges: [
        kind === 'juicing'
          ? {
              key: `juice:${id}`,
              kind: 'juicing',
              equipment: '柑橘榨汁機',
              fromIngredientIds: [],
              toIngredientIds: ['lemon'],
            }
          : {
              key: `finish:${id}`,
              kind: 'finalizing',
              equipment: '果汁成品台',
              fromIngredientIds: ['lemon'],
              toIngredientIds: ['lemon'],
            },
      ],
    },
  }
}

describe('Debug-D Production P4 ordering and fallback', () => {
  it('honors jar-switch-first ordering instead of forcing minimum cost first', async () => {
    const customers = [
      customer('a', '酸味'),
      customer('b', '清新口氣'),
    ]
    const candidates = [
      recipe('a-only', ['檸檬'], ['酸味']),
      recipe('b-only', ['橙子'], ['清新口氣']),
      recipe(
        'shared',
        ['檸檬', '糖', '薄荷'],
        ['酸味', '清新口氣'],
      ),
    ]

    const costFirst = await optimizeBatchPlan(
      {
        ...baseRequest(['a', 'b']),
        availableJuiceJarCount: 1,
        priorities: ['minimum-cost', 'minimum-jar-switches'],
      },
      { source: { customers, candidates } },
    )
    const jarFirst = await optimizeBatchPlan(
      {
        ...baseRequest(['a', 'b']),
        availableJuiceJarCount: 1,
        priorities: ['minimum-jar-switches', 'minimum-cost'],
      },
      { source: { customers, candidates } },
    )

    expect(costFirst.totalIngredientCost).toBe(20)
    expect(costFirst.jarTypeSwitches).toBe(1)
    expect(costFirst.recipePlans).toHaveLength(2)

    expect(jarFirst.totalIngredientCost).toBe(30)
    expect(jarFirst.jarTypeSwitches).toBe(0)
    expect(jarFirst.recipePlans).toHaveLength(1)
    expect(jarFirst.recipePlans[0].recipeId).toBe('shared')
  })

  it('falls back to the generic machine model when the certificate lower bound cannot close', async () => {
    // 4000 continuation recipes crosses the production certificate gate.
    // Each partition can claim a zero lower bound by selecting the opposite
    // edge kind, but no real recipe has zero total machine operations.
    // The certificate therefore cannot close and the integrated solver must
    // continue with the generic exact machine stage.
    const recipes = Array.from({ length: 4000 }, (_, index) =>
      fallbackRecipe(
        `fallback-${index}`,
        index % 2 === 0 ? 'juicing' : 'finalizing',
      ),
    )
    const request: OptimizationRequest = {
      ...baseRequest(['a']),
      availableJuiceJarCount: 1,
      priorities: ['minimum-cost', 'minimum-machine-operations'],
    }
    const domain: BatchOptimizationModel = {
      request,
      serviceableCustomerIds: ['a'],
      unresolvedCustomerIds: [],
      excludedSuppliedCustomerIds: [],
      recipes,
    }

    const solution = await highsSolverAdapter.solve(
      domain,
      request.priorities!,
    )

    expect(solution.assignments).toHaveLength(1)
    expect(solution.metrics.totalIngredientCost).toBe(1)
    expect(solution.metrics.totalProductionUnits).toBe(1)
    expect(solution.metrics.machineOperations).toBe(1)
  }, 30000)
})

describe('Debug-D Production P4 production-scale benchmark', () => {
  it('solves the Blender workload through the production solver with the certified optimum', async () => {
    const customerIds = canonicalCustomers.map((item) => item.id)
    const request: OptimizationRequest = {
      customerIds,
      currentProgress: 'juice-blender-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
      },
      formalCustomerIds: customerIds,
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-cost',
      priorities: [
        'minimum-cost',
        'minimum-machine-operations',
        'minimum-jar-switches',
      ],
      availableJuiceJarCount: 2,
    }

    const startedAt = performance.now()
    const result = await optimizeBatchPlan(request)
    const elapsedMs = performance.now() - startedAt

    console.info(
      `[Debug-D P4 benchmark] Blender production solve: ${elapsedMs.toFixed(0)} ms`,
    )

    expect(result.totalIngredientCost).toBe(572)
    expect(result.machineOperations.total).toBe(50)
    expect(result.jarTypeSwitches).toBe(19)
    expect(result.assignments).toHaveLength(48)
    expect(result.unresolvedCustomers).toHaveLength(4)
  }, 45000)
})
