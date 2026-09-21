import { describe, expect, it } from 'vitest'
import type { InventoryState } from '../types'
import type { PreparationDemand } from './preparationDemand'
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
