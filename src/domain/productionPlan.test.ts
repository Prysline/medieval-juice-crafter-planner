import { describe, expect, it } from 'vitest'
import { buildProductionPlan } from './productionPlan'

describe('production plan', () => {
  it('shares common prefixes before splitting final recipes', () => {
    const result = buildProductionPlan([
      {
        recipeId: 'ab',
        recipeName: 'AB',
        ingredientIds: ['lemon', 'sugar'],
        juiceUnits: 1,
        assignedServings: 1,
      },
      {
        recipeId: 'abc',
        recipeName: 'ABC',
        ingredientIds: ['lemon', 'sugar', 'mint'],
        juiceUnits: 2,
        assignedServings: 3,
      },
    ])

    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'juice:lemon',
          quantity: 3,
          operationCount: 1,
        }),
        expect.objectContaining({
          key: 'season:lemon>sugar',
          quantity: 3,
          operationCount: 1,
          recipeIds: ['ab', 'abc'],
        }),
        expect.objectContaining({
          key: 'season:lemon>sugar>mint',
          quantity: 2,
          operationCount: 1,
          recipeIds: ['abc'],
        }),
      ]),
    )
    expect(result.machineOperations).toEqual({
      total: 5,
      juicing: 1,
      seasoning: 2,
      finalizing: 2,
      blending: 0,
    })
  })

  it('counts repeated seasoning as separate operation layers and packs each layer by five', () => {
    const result = buildProductionPlan([
      {
        recipeId: 'abb',
        recipeName: 'ABB',
        ingredientIds: ['lemon', 'mint', 'mint'],
        juiceUnits: 7,
        assignedServings: 14,
      },
    ])

    expect(result.steps.map((step) => ({
      key: step.key,
      quantity: step.quantity,
      operationCount: step.operationCount,
    }))).toEqual([
      { key: 'juice:lemon', quantity: 7, operationCount: 2 },
      {
        key: 'season:lemon>mint',
        quantity: 7,
        operationCount: 2,
      },
      {
        key: 'season:lemon>mint>mint',
        quantity: 7,
        operationCount: 2,
      },
      {
        key: 'finish:lemon>mint>mint',
        quantity: 7,
        operationCount: 2,
      },
    ])
    expect(result.machineOperations.total).toBe(8)
    expect(result.machineOperations.seasoning).toBe(4)
  })
})
