import { describe, expect, it } from 'vitest'
import { juiceStateIdentity } from './juiceStateIdentity'
import {
  buildProductionPlan,
  buildStockOffsetProductionPlan,
} from './productionPlan'

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


describe('production plan stock offset', () => {
  it('uses a deeper seasoned stock node before expanding its upstream edges', () => {
    const identity = juiceStateIdentity(['lemon', 'sugar'])
    const result = buildStockOffsetProductionPlan(
      [
        {
          recipeId: 'lemon-sugar-mint',
          recipeName: 'Lemon Sugar Mint',
          ingredientIds: ['lemon', 'sugar', 'mint'],
          juiceUnits: 2,
          assignedServings: 4,
        },
      ],
      { [identity]: 1 },
    )

    expect(
      result.steps.map((step) => ({
        key: step.key,
        quantity: step.quantity,
      })),
    ).toEqual([
      { key: 'juice:lemon', quantity: 1 },
      { key: 'season:lemon>sugar', quantity: 1 },
      { key: 'season:lemon>sugar>mint', quantity: 2 },
      { key: 'finish:lemon>sugar>mint', quantity: 2 },
    ])
    expect(result.intermediateStockUsage).toEqual([
      {
        identity,
        ingredientIds: ['lemon', 'sugar'],
        availableUnits: 1,
        usedUnits: 1,
        remainingUnits: 0,
      },
    ])
  })

  it('prefers the deepest available stock before using its ancestor stock', () => {
    const baseIdentity = juiceStateIdentity(['lemon'])
    const seasonedIdentity = juiceStateIdentity(['lemon', 'sugar'])
    const result = buildStockOffsetProductionPlan(
      [
        {
          recipeId: 'lemon-sugar-mint',
          recipeName: 'Lemon Sugar Mint',
          ingredientIds: ['lemon', 'sugar', 'mint'],
          juiceUnits: 2,
          assignedServings: 4,
        },
      ],
      {
        [baseIdentity]: 1,
        [seasonedIdentity]: 1,
      },
    )

    expect(
      result.steps.find((step) => step.key === 'juice:lemon'),
    ).toBeUndefined()
    expect(
      result.steps.find(
        (step) => step.key === 'season:lemon>sugar',
      ),
    ).toMatchObject({ quantity: 1 })
    expect(
      result.steps.find(
        (step) => step.key === 'season:lemon>sugar>mint',
      ),
    ).toMatchObject({ quantity: 2 })
    expect(result.intermediateStockUsage).toEqual([
      expect.objectContaining({
        identity: seasonedIdentity,
        usedUnits: 1,
      }),
      expect.objectContaining({
        identity: baseIdentity,
        usedUnits: 1,
      }),
    ])
  })

  it('uses already blended stock while keeping finalizing work', () => {
    const identity = juiceStateIdentity([
      'lemon',
      'sugar',
      'orange',
      'mint',
    ])
    const result = buildStockOffsetProductionPlan(
      [
        {
          recipeId: 'blend',
          recipeName: 'Blend',
          ingredientIds: ['lemon', 'sugar', 'orange', 'mint'],
          juiceUnits: 2,
          assignedServings: 4,
        },
      ],
      { [identity]: 1 },
    )

    expect(
      result.steps.map((step) => ({
        key: step.key,
        quantity: step.quantity,
      })),
    ).toEqual(
      expect.arrayContaining([
        { key: 'juice:lemon', quantity: 1 },
        { key: 'season:lemon>sugar', quantity: 1 },
        { key: 'juice:orange', quantity: 1 },
        { key: 'season:orange>mint', quantity: 1 },
        {
          key: 'blend:lemon>sugar+orange>mint',
          quantity: 1,
        },
        {
          key: 'finish:lemon>sugar>orange>mint',
          quantity: 2,
        },
      ]),
    )
    expect(result.machineOperations.finalizing).toBe(1)
    expect(result.intermediateStockUsage[0]).toMatchObject({
      identity,
      usedUnits: 1,
    })
  })

  it('does not spend one shared-prefix stock unit twice', () => {
    const identity = juiceStateIdentity(['lemon', 'sugar'])
    const result = buildStockOffsetProductionPlan(
      [
        {
          recipeId: 'ab',
          recipeName: 'AB',
          ingredientIds: ['lemon', 'sugar'],
          juiceUnits: 1,
          assignedServings: 2,
        },
        {
          recipeId: 'abc',
          recipeName: 'ABC',
          ingredientIds: ['lemon', 'sugar', 'mint'],
          juiceUnits: 1,
          assignedServings: 2,
        },
      ],
      { [identity]: 1 },
    )

    expect(
      result.steps.find((step) => step.key === 'juice:lemon'),
    ).toMatchObject({ quantity: 1 })
    expect(
      result.steps.find(
        (step) => step.key === 'season:lemon>sugar',
      ),
    ).toMatchObject({ quantity: 1 })
    expect(
      result.steps.find(
        (step) => step.key === 'season:lemon>sugar>mint',
      ),
    ).toMatchObject({ quantity: 1 })
    expect(result.intermediateStockUsage).toEqual([
      expect.objectContaining({
        identity,
        availableUnits: 1,
        usedUnits: 1,
        remainingUnits: 0,
      }),
    ])
  })

  it('consumes one stock unit only once when a blender needs the same node twice', () => {
    const identity = juiceStateIdentity(['lemon', 'sugar'])
    const result = buildStockOffsetProductionPlan(
      [
        {
          recipeId: 'double-lemon',
          recipeName: 'Double Lemon',
          ingredientIds: ['lemon', 'sugar', 'lemon', 'sugar'],
          juiceUnits: 1,
          assignedServings: 2,
        },
      ],
      { [identity]: 1 },
    )

    expect(
      result.steps.find((step) => step.key === 'juice:lemon'),
    ).toMatchObject({ quantity: 1 })
    expect(
      result.steps.find(
        (step) => step.key === 'season:lemon>sugar',
      ),
    ).toMatchObject({ quantity: 1 })
    expect(
      result.steps.find(
        (step) => step.key === 'blend:lemon>sugar+lemon>sugar',
      ),
    ).toMatchObject({ quantity: 1 })
    expect(result.intermediateStockUsage[0]).toMatchObject({
      identity,
      usedUnits: 1,
      remainingUnits: 0,
    })
  })
})
