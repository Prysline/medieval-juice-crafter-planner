import { describe, expect, it } from 'vitest'
import type {
  BatchOptimizationModel,
  EligibleOptimizationRecipe,
  OptimizationRequest,
} from './optimizerModel'
import { reduceMachineCertificatePartitionDomain } from './optimizerMachinePartitionReduction'
import type { ProductionStepKind } from './productionPlan'

const baseRequest: OptimizationRequest = {
  customerIds: ['a', 'b', 'c'],
  currentProgress: 'juice-blender-unlocked',
  suppliedCustomerIds: [],
  satisfactionByVillage: {
    'east-harbor': 999,
    'tranquil-fountain': 999,
    'ibex-statue': 0,
  },
  formalCustomerIds: ['a', 'b', 'c'],
  candidatePolicy: 'allow-unambiguous-computed',
  objective: 'minimum-cost',
  priorities: ['minimum-cost', 'minimum-machine-operations'],
  availableJuiceJarCount: 2,
}

function edge(
  key: string,
  kind: ProductionStepKind,
) {
  return {
    key,
    kind,
    equipment: '果汁成品台' as const,
    fromIngredientIds: ['lemon'],
    toIngredientIds: ['lemon'],
  }
}

function recipe(
  id: string,
  cost: number,
  eligibleCustomerIds: string[],
  edges: Array<ReturnType<typeof edge>>,
  overrides: Partial<EligibleOptimizationRecipe> = {},
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
    juiceUnitIngredientCost: cost,
    eligibleCustomerIds,
    productionPath: {
      ingredientIds: ['lemon'],
      edges,
    },
    ...overrides,
  }
}

function model(
  recipes: EligibleOptimizationRecipe[],
  request: OptimizationRequest = baseRequest,
): BatchOptimizationModel {
  return {
    request,
    serviceableCustomerIds: ['a', 'b', 'c'],
    unresolvedCustomerIds: [],
    excludedSuppliedCustomerIds: [],
    recipes,
  }
}

function ids(domain: BatchOptimizationModel): string[] {
  return domain.recipes.map((entry) => entry.candidate.id)
}

describe('machine certificate finalizing reduction', () => {
  it('groups finalizing recipes by service and cost when every finalizing edge is recipe-unique', () => {
    const domain = model([
      recipe('same-1', 4, ['a', 'b'], [
        edge('final-1', 'finalizing'),
      ]),
      recipe('same-2', 4, ['b', 'a'], [
        edge('final-2', 'finalizing'),
      ]),
      recipe('different-cost', 5, ['a', 'b'], [
        edge('final-3', 'finalizing'),
      ]),
      recipe('different-service', 4, ['c'], [
        edge('final-4', 'finalizing'),
      ]),
    ])

    const reduced = reduceMachineCertificatePartitionDomain(
      domain,
      { key: 'finalizing', kinds: ['finalizing'] },
    )

    expect(ids(reduced)).toEqual([
      'same-1',
      'different-cost',
      'different-service',
    ])
  })

  it('keeps through-seasoning and blending on the original domain', () => {
    const domain = model([
      recipe('a', 4, ['a', 'b'], [edge('shared', 'juicing')]),
      recipe('b', 4, ['a', 'b'], [edge('shared', 'juicing')]),
    ])

    expect(
      reduceMachineCertificatePartitionDomain(domain, {
        key: 'throughSeasoning',
        kinds: ['juicing', 'seasoning'],
      }),
    ).toBe(domain)
    expect(
      reduceMachineCertificatePartitionDomain(domain, {
        key: 'blending',
        kinds: ['blending'],
      }),
    ).toBe(domain)
  })

  it('falls back when recipe-level production caps or finished stock make identity part of feasibility', () => {
    const capped = model([
      recipe(
        'capped-a',
        4,
        ['a', 'b'],
        [edge('final-a', 'finalizing')],
        { maxProductionUnits: 1 },
      ),
      recipe('capped-b', 4, ['a', 'b'], [
        edge('final-b', 'finalizing'),
      ]),
    ])
    const stocked = model([
      recipe(
        'stock-a',
        4,
        ['a', 'b'],
        [edge('final-c', 'finalizing')],
        { initialFinishedServings: 1 },
      ),
      recipe('stock-b', 4, ['a', 'b'], [
        edge('final-d', 'finalizing'),
      ]),
    ])

    expect(
      reduceMachineCertificatePartitionDomain(capped, {
        key: 'finalizing',
        kinds: ['finalizing'],
      }),
    ).toBe(capped)
    expect(
      reduceMachineCertificatePartitionDomain(stocked, {
        key: 'finalizing',
        kinds: ['finalizing'],
      }),
    ).toBe(stocked)
  })

  it('falls back for inventory-only, hard jar constraints, occupied-only jars, and shared finalizing edges', () => {
    const recipes = [
      recipe('a', 4, ['a', 'b'], [edge('shared-final', 'finalizing')]),
      recipe('b', 4, ['a', 'b'], [edge('shared-final', 'finalizing')]),
    ]
    const inventoryOnly = model(recipes, {
      ...baseRequest,
      materialSourceMode: 'inventory-only',
      materialInventory: { ingredientUnits: {} },
    })
    const hardJar = model(recipes, {
      ...baseRequest,
      constraints: { maxJarTypeSwitches: 0 },
    })
    const occupiedOnly = model(recipes, {
      ...baseRequest,
      initialAvailableJuiceJars: [
        { recipeId: 'legacy', servings: 1 },
      ],
    })
    const sharedFinalizing = model(recipes)

    for (const domain of [
      inventoryOnly,
      hardJar,
      occupiedOnly,
      sharedFinalizing,
    ]) {
      expect(
        reduceMachineCertificatePartitionDomain(domain, {
          key: 'finalizing',
          kinds: ['finalizing'],
        }),
      ).toBe(domain)
    }
  })

  it('rejects a finalizing proof when the partition kind set changes', () => {
    const domain = model([
      recipe('a', 4, ['a', 'b'], [edge('final-a', 'finalizing')]),
      recipe('b', 4, ['a', 'b'], [edge('final-b', 'finalizing')]),
    ])

    expect(
      reduceMachineCertificatePartitionDomain(domain, {
        key: 'finalizing',
        kinds: ['juicing'],
      }),
    ).toBe(domain)
  })
})