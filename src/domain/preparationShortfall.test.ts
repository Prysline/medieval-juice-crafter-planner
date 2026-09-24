import { describe, expect, it } from 'vitest'
import type { InventoryState } from '../types'
import type { PreparationDemand } from './preparationDemand'
import { juiceStateIdentity } from './juiceStateIdentity'
import { buildPreparationShortfall } from './preparationShortfall'

const demand: PreparationDemand = {
  ingredients: [
    { ingredientId: 'lemon', name: '檸檬', quantity: 2 },
    { ingredientId: 'sugar', name: '糖', quantity: 2 },
  ],
  productionWaterUnits: 2,
  cleanCupUses: 3,
  producedServings: 4,
  assignedServings: 3,
  leftoverServings: 1,
  recipes: [
    {
      recipeId: 'lemon-sugar',
      recipeName: '檸檬糖',
      customerIds: ['a', 'b', 'c'],
      ingredientIds: ['lemon', 'sugar'],
      productionUnits: 2,
      producedServings: 4,
      assignedServings: 3,
      leftoverServings: 1,
      ingredientUnitsPerJuiceUnit: [
        { ingredientId: 'lemon', quantityPerJuiceUnit: 1 },
        { ingredientId: 'sugar', quantityPerJuiceUnit: 1 },
      ],
    },
  ],
}

function inventory(
  patch: Partial<InventoryState> = {},
): InventoryState {
  return {
    ingredientUnits: {},
    waterUnits: 0,
    cleanCups: 0,
    usedCups: 0,
    juiceJars: [],
    shelfCount: 0,
    jarRackCount: 0,
    ...patch,
  }
}

describe('preparation stock shortfall', () => {
  it('uses finished recipe stock before deciding new production units', () => {
    const result = buildPreparationShortfall(
      demand,
      inventory({
        ingredientUnits: { lemon: 1 },
        waterUnits: 0,
        cleanCups: 2,
        usedCups: 4,
        juiceJars: [
          {
            id: 'jar-1',
            recipeId: 'lemon-sugar',
            servings: 1,
          },
        ],
      }),
    )

    expect(result.recipes[0]).toMatchObject({
      assignedServings: 3,
      finishedServingsAvailable: 1,
      finishedServingsUsed: 1,
      finishedServingsRemaining: 0,
      servingsToProduce: 2,
      juiceUnitsToPrepare: 1,
      newlyProducedServings: 2,
      newProductionLeftoverServings: 0,
      finishedStockSources: [
        {
          physicalJarId: 'jar-1',
          recipeId: 'lemon-sugar',
          initialServings: 1,
          servingsUsed: 1,
          servingsRemaining: 0,
        },
      ],
    })
    expect(result.ingredients).toEqual(
      expect.arrayContaining([
        {
          ingredientId: 'lemon',
          name: '檸檬',
          requiredUnits: 1,
          inventoryUnitsAvailable: 1,
          inventoryUnitsUsed: 1,
          purchaseUnits: 0,
        },
        {
          ingredientId: 'sugar',
          name: '糖',
          requiredUnits: 1,
          inventoryUnitsAvailable: 0,
          inventoryUnitsUsed: 0,
          purchaseUnits: 1,
        },
      ]),
    )
    expect(result.productionWaterUnitsRequired).toBe(1)
    expect(result.waterUnitsToFetch).toBe(1)
    expect(result.cleanCupUses).toBe(3)
    expect(result.cleanCupShortfallBeforeWashing).toBe(1)
    expect(result.usedCupsAvailable).toBe(4)
  })

  it('can satisfy a recipe entirely from finished stock without new ingredients or water', () => {
    const result = buildPreparationShortfall(
      demand,
      inventory({
        juiceJars: [
          {
            id: 'jar-1',
            recipeId: 'lemon-sugar',
            servings: 5,
          },
        ],
      }),
    )

    expect(result.recipes[0]).toMatchObject({
      finishedServingsUsed: 3,
      finishedServingsRemaining: 2,
      servingsToProduce: 0,
      juiceUnitsToPrepare: 0,
      newlyProducedServings: 0,
    })
    expect(result.ingredients).toEqual([])
    expect(result.productionWaterUnitsRequired).toBe(0)
    expect(result.waterUnitsToFetch).toBe(0)
  })

  it('uses existing finished stock while emptying smaller same-recipe jars first', () => {
    const result = buildPreparationShortfall(
      demand,
      inventory({
        juiceJars: [
          {
            id: 'jar-large-first',
            recipeId: 'lemon-sugar',
            servings: 4,
          },
          {
            id: 'jar-small-second',
            recipeId: 'lemon-sugar',
            servings: 2,
          },
        ],
      }),
    )

    expect(result.recipes[0]).toMatchObject({
      finishedServingsAvailable: 6,
      finishedServingsUsed: 3,
      finishedServingsRemaining: 3,
      finishedStockSources: [
        {
          physicalJarId: 'jar-small-second',
          recipeId: 'lemon-sugar',
          initialServings: 2,
          servingsUsed: 2,
          servingsRemaining: 0,
        },
        {
          physicalJarId: 'jar-large-first',
          recipeId: 'lemon-sugar',
          initialServings: 4,
          servingsUsed: 1,
          servingsRemaining: 3,
        },
      ],
      servingsToProduce: 0,
    })
  })

  it('only offsets finished stock from explicitly eligible carried jars', () => {
    const result = buildPreparationShortfall(
      demand,
      inventory({
        juiceJars: [
          {
            id: 'not-carried',
            recipeId: 'lemon-sugar',
            servings: 3,
          },
          {
            id: 'carried',
            recipeId: 'lemon-sugar',
            servings: 1,
          },
        ],
      }),
      { finishedJuiceJarIds: ['carried'] },
    )

    expect(result.recipes[0]).toMatchObject({
      finishedServingsAvailable: 1,
      finishedServingsUsed: 1,
      finishedServingsRemaining: 0,
      finishedStockSources: [
        {
          physicalJarId: 'carried',
          recipeId: 'lemon-sugar',
          initialServings: 1,
          servingsUsed: 1,
          servingsRemaining: 0,
        },
      ],
      servingsToProduce: 2,
      juiceUnitsToPrepare: 1,
    })
  })

  it('uses raw inventory and water without mutating the input state', () => {
    const state = inventory({
      ingredientUnits: {
        lemon: 5,
        sugar: 1,
      },
      waterUnits: 1,
    })

    const before = structuredClone(state)
    const result = buildPreparationShortfall(demand, state)

    expect(result.ingredients).toEqual(
      expect.arrayContaining([
        {
          ingredientId: 'lemon',
          name: '檸檬',
          requiredUnits: 2,
          inventoryUnitsAvailable: 5,
          inventoryUnitsUsed: 2,
          purchaseUnits: 0,
        },
        {
          ingredientId: 'sugar',
          name: '糖',
          requiredUnits: 2,
          inventoryUnitsAvailable: 1,
          inventoryUnitsUsed: 1,
          purchaseUnits: 1,
        },
      ]),
    )
    expect(result.productionWaterUnitsRequired).toBe(2)
    expect(result.waterUnitsUsed).toBe(1)
    expect(result.waterUnitsToFetch).toBe(1)
    expect(state).toEqual(before)
  })


  it('offsets upstream raw ingredients with existing intermediate juice stock', () => {
    const identity = juiceStateIdentity(['lemon'])
    const result = buildPreparationShortfall(
      demand,
      inventory({
        intermediateJuiceUnits: {
          [identity]: 1,
        },
      }),
    )

    expect(result.ingredients).toEqual(
      expect.arrayContaining([
        {
          ingredientId: 'lemon',
          name: '檸檬',
          requiredUnits: 1,
          inventoryUnitsAvailable: 0,
          inventoryUnitsUsed: 0,
          purchaseUnits: 1,
        },
        {
          ingredientId: 'sugar',
          name: '糖',
          requiredUnits: 2,
          inventoryUnitsAvailable: 0,
          inventoryUnitsUsed: 0,
          purchaseUnits: 2,
        },
      ]),
    )
    expect(result.productionWaterUnitsRequired).toBe(2)
    expect(result.intermediateStockUsage).toEqual([
      {
        identity,
        ingredientIds: ['lemon'],
        availableUnits: 1,
        usedUnits: 1,
        remainingUnits: 0,
      },
    ])
    expect(
      result.netProductionPlan?.steps.map((step) => ({
        key: step.key,
        quantity: step.quantity,
      })),
    ).toEqual([
      { key: 'juice:lemon', quantity: 1 },
      { key: 'season:lemon>sugar', quantity: 2 },
      { key: 'finish:lemon>sugar', quantity: 2 },
    ])
  })


  it('does not count used cups as clean before a washing plan exists', () => {
    const result = buildPreparationShortfall(
      demand,
      inventory({
        cleanCups: 1,
        usedCups: 20,
      }),
    )

    expect(result.cleanCupUses).toBe(3)
    expect(result.cleanCupsAvailable).toBe(1)
    expect(result.cleanCupShortfallBeforeWashing).toBe(2)
    expect(result.usedCupsAvailable).toBe(20)
  })
})
