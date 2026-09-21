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

  it('builds two drink segments before blending and finalizing', () => {
    const result = buildProductionPlan([
      {
        recipeId: 'blend',
        recipeName: 'Blend',
        ingredientIds: ['lemon', 'sugar', 'orange', 'mint'],
        juiceUnits: 3,
        assignedServings: 6,
      },
    ])

    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'juice:lemon',
          kind: 'juicing',
          quantity: 3,
        }),
        expect.objectContaining({
          key: 'season:lemon>sugar',
          kind: 'seasoning',
          quantity: 3,
        }),
        expect.objectContaining({
          key: 'juice:orange',
          kind: 'juicing',
          quantity: 3,
        }),
        expect.objectContaining({
          key: 'season:orange>mint',
          kind: 'seasoning',
          quantity: 3,
        }),
        expect.objectContaining({
          key: 'blend:lemon>sugar+orange>mint',
          kind: 'blending',
          equipment: '果汁調和器',
          fromIngredientIds: ['lemon', 'sugar'],
          secondaryFromIngredientIds: ['orange', 'mint'],
          toIngredientIds: ['lemon', 'sugar', 'orange', 'mint'],
          quantity: 3,
          operationCount: 1,
        }),
        expect.objectContaining({
          key: 'finish:lemon>sugar>orange>mint',
          kind: 'finalizing',
          quantity: 3,
        }),
      ]),
    )

    expect(result.machineOperations).toEqual({
      total: 6,
      juicing: 2,
      seasoning: 2,
      blending: 1,
      finalizing: 1,
    })
  })

  it('counts duplicate drink segments twice before blending', () => {
    const result = buildProductionPlan([
      {
        recipeId: 'double-lemon',
        recipeName: 'Double Lemon',
        ingredientIds: ['lemon', 'sugar', 'lemon', 'sugar'],
        juiceUnits: 2,
        assignedServings: 4,
      },
    ])

    expect(
      result.steps.find((step) => step.key === 'juice:lemon'),
    ).toMatchObject({
      quantity: 4,
      operationCount: 1,
    })
    expect(
      result.steps.find((step) => step.key === 'season:lemon>sugar'),
    ).toMatchObject({
      quantity: 4,
      operationCount: 1,
    })
    expect(
      result.steps.find(
        (step) => step.key === 'blend:lemon>sugar+lemon>sugar',
      ),
    ).toMatchObject({
      quantity: 2,
      operationCount: 1,
    })
  })


  it('feeds an already blended drink into a second blender step', () => {
    const result = buildProductionPlan([
      {
        recipeId: 'three-base-blend',
        recipeName: 'Three Base Blend',
        ingredientIds: ['lemon', 'carrot', 'mint', 'sugar', 'pear'],
        juiceUnits: 2,
        assignedServings: 4,
      },
    ])

    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'blend:lemon+carrot>mint>sugar',
          kind: 'blending',
          fromIngredientIds: ['lemon'],
          secondaryFromIngredientIds: ['carrot', 'mint', 'sugar'],
          toIngredientIds: ['lemon', 'carrot', 'mint', 'sugar'],
          quantity: 2,
          operationCount: 1,
        }),
        expect.objectContaining({
          key: 'blend:lemon>carrot>mint>sugar+pear',
          kind: 'blending',
          fromIngredientIds: ['lemon', 'carrot', 'mint', 'sugar'],
          secondaryFromIngredientIds: ['pear'],
          toIngredientIds: ['lemon', 'carrot', 'mint', 'sugar', 'pear'],
          quantity: 2,
          operationCount: 1,
        }),
      ]),
    )
    expect(result.machineOperations.blending).toBe(2)
  })
})
