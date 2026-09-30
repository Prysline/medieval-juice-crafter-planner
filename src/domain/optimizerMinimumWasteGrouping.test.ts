import { describe, expect, it } from 'vitest'
import type { Customer, RecipeCandidate } from '../types'
import { optimizeBatchPlan } from './optimizer'
import {
  minimumWasteEquivalentAssignmentGroupingIsSafe,
} from './optimizerHighsSolver'
import type {
  BatchOptimizationModel,
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

function request(
  customerIds: string[],
  priorities: OptimizationRequest['priorities'] = ['minimum-waste'],
): OptimizationRequest {
  return {
    customerIds,
    currentProgress: 'seasoner-unlocked',
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
      'ibex-statue': 0,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'observed-only',
    objective: 'minimum-waste',
    priorities,
    availableJuiceJarCount: 2,
  }
}

function safetyDomain(
  overrides: Partial<OptimizationRequest> = {},
): BatchOptimizationModel {
  return {
    request: {
      ...request(['a']),
      ...overrides,
    },
    serviceableCustomerIds: ['a'],
    unresolvedCustomerIds: [],
    excludedSuppliedCustomerIds: [],
    recipes: [],
  }
}

describe('minimum-waste equivalent-assignment grouping', () => {
  it('only enables the exact grouping where recipe-specific jar or inventory authority is not required', () => {
    expect(
      minimumWasteEquivalentAssignmentGroupingIsSafe(
        safetyDomain(),
      ),
    ).toBe(true)

    expect(
      minimumWasteEquivalentAssignmentGroupingIsSafe(
        safetyDomain({
          materialSourceMode: 'inventory-only',
          materialInventory: {
            ingredientUnits: {},
            intermediateJuiceUnits: {},
          },
        }),
      ),
    ).toBe(false)

    expect(
      minimumWasteEquivalentAssignmentGroupingIsSafe(
        safetyDomain({
          initialAvailableJuiceJars: [
            { recipeId: 'stocked', servings: 1 },
          ],
        }),
      ),
    ).toBe(false)

    expect(
      minimumWasteEquivalentAssignmentGroupingIsSafe(
        safetyDomain({
          constraints: { maxJarTypeSwitches: 0 },
        }),
      ),
    ).toBe(false)

    expect(
      minimumWasteEquivalentAssignmentGroupingIsSafe(
        safetyDomain({
          constraints: { maxJarFillOperations: 3 },
        }),
      ),
    ).toBe(true)

    expect(
      minimumWasteEquivalentAssignmentGroupingIsSafe({
        ...safetyDomain({
          initialAvailableJuiceJars: [
            { recipeId: 'stock-only', servings: 1 },
            { recipeId: null, servings: 0 },
          ],
        }),
        recipes: [
          {
            candidate: recipe(
              'stock-only',
              ['檸檬', '糖'],
              ['甜味'],
            ),
            juiceUnitIngredientCost: 16,
            initialFinishedServings: 1,
            maxProductionUnits: 0,
            eligibleCustomerIds: ['a'],
            productionPath: {
              ingredientIds: ['lemon', 'sugar'],
              edges: [],
            },
          },
        ],
      }),
    ).toBe(false)
  })

  it('keeps different-cost recipe identities distinct while grouping exact maximum-cost assignments', async () => {
    const result = await optimizeBatchPlan(
      request(
        ['a', 'b'],
        ['minimum-waste', 'maximum-ingredient-cost'],
      ),
      {
        source: {
          customers: [
            customer('a', '甜味'),
            customer('b', '甜味'),
          ],
          candidates: [
            recipe('cheap', ['檸檬'], ['甜味']),
            recipe(
              'expensive',
              ['檸檬', '糖', '薄荷'],
              ['甜味'],
            ),
          ],
        },
      },
    )

    expect(result.assignments).toEqual([
      { customerId: 'a', recipeId: 'expensive' },
      { customerId: 'b', recipeId: 'expensive' },
    ])
    expect(result.recipePlans).toEqual([
      expect.objectContaining({
        recipeId: 'expensive',
        juiceUnits: 1,
        assignedServings: 2,
      }),
    ])
    expect(result.leftoverServings).toBe(0)
  })

  it('keeps initial finished servings in the grouped minimum-waste capacity calculation when an empty jar remains', async () => {
    const result = await optimizeBatchPlan(
      {
        ...request(['a']),
        initialAvailableJuiceJars: [
          { recipeId: 'stocked', servings: 1 },
          { recipeId: null, servings: 0 },
        ],
      },
      {
        source: {
          customers: [customer('a', '甜味')],
          candidates: [
            recipe('stocked', ['檸檬', '糖'], ['甜味']),
            recipe('other', ['檸檬'], ['甜味']),
          ],
        },
      },
    )

    expect(result.assignments).toEqual([
      { customerId: 'a', recipeId: 'stocked' },
    ])
    expect(result.producedServings).toBe(0)
    expect(result.totalIngredientCost).toBe(0)
  })

  it('falls back to the generic exact stage for all-nonempty jars and jar-type hard limits', async () => {
    const customers = [customer('a', '甜味')]
    const candidates = [
      recipe('stocked', ['檸檬', '糖'], ['甜味']),
    ]

    const allNonempty = await optimizeBatchPlan(
      {
        ...request(
          ['a'],
          ['minimum-waste', 'maximum-ingredient-cost'],
        ),
        initialAvailableJuiceJars: [
          { recipeId: 'stocked', servings: 1 },
        ],
      },
      { source: { customers, candidates } },
    )
    expect(allNonempty.producedServings).toBe(0)

    const hardLimit = await optimizeBatchPlan(
      {
        ...request(
          ['a'],
          ['minimum-waste', 'maximum-ingredient-cost'],
        ),
        initialAvailableJuiceJars: [
          { recipeId: null, servings: 0 },
        ],
        constraints: { maxJarTypeSwitches: 0 },
      },
      { source: { customers, candidates } },
    )
    expect(hardLimit.assignments).toEqual([
      { customerId: 'a', recipeId: 'stocked' },
    ])
  })

  it('does not group a later minimum-waste stage after an assignment-sensitive objective', async () => {
    const result = await optimizeBatchPlan(
      {
        ...request(
          ['a', 'b'],
          ['maximum-ingredient-cost', 'minimum-waste'],
        ),
      },
      {
        source: {
          customers: [
            customer('a', '甜味'),
            customer('b', '甜味'),
          ],
          candidates: [
            recipe('cheap', ['檸檬'], ['甜味']),
            recipe(
              'expensive',
              ['檸檬', '糖', '薄荷'],
              ['甜味'],
            ),
          ],
        },
      },
    )

    expect(result.assignments.every(
      (assignment) => assignment.recipeId === 'expensive',
    )).toBe(true)
    expect(result.leftoverServings).toBe(0)
  })

  it('keeps inventory-only maximum-coverage authority ahead of minimum-waste', async () => {
    const result = await optimizeBatchPlan(
      {
        ...request(['a', 'b']),
        materialSourceMode: 'inventory-only',
        materialInventory: {
          ingredientUnits: { lemon: 1 },
          intermediateJuiceUnits: {},
        },
      },
      {
        source: {
          customers: [
            customer('a', '甜味'),
            customer('b', '清新口氣'),
          ],
          candidates: [
            recipe('sweet', ['檸檬'], ['甜味']),
            recipe('fresh', ['橙子'], ['清新口氣']),
          ],
        },
      },
    )

    expect(result.assignments).toEqual([
      { customerId: 'a', recipeId: 'sweet' },
    ])
    expect(result.inventoryUnfulfilledCustomers).toEqual(['b'])
  })
})
