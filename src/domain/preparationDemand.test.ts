import { describe, expect, it } from 'vitest'
import type { OptimizationResult } from './optimizer'
import { buildPreparationDemand } from './preparationDemand'

const result: OptimizationResult = {
  assignments: [
    { customerId: 'a', recipeId: 'lemon' },
    { customerId: 'b', recipeId: 'lemon' },
    { customerId: 'c', recipeId: 'orange' },
  ],
  recipePlans: [
    {
      recipeId: 'lemon',
      recipeName: '檸檬汁',
      customerIds: ['a', 'b'],
      juiceUnits: 1,
      producedServings: 2,
      assignedServings: 2,
      leftoverServings: 0,
      ingredientIds: ['lemon'],
      juiceUnitIngredientCost: 9,
      totalIngredientCost: 9,
    },
    {
      recipeId: 'orange',
      recipeName: '橙汁',
      customerIds: ['c'],
      juiceUnits: 1,
      producedServings: 2,
      assignedServings: 1,
      leftoverServings: 1,
      ingredientIds: ['orange'],
      juiceUnitIngredientCost: 11,
      totalIngredientCost: 11,
    },
  ],
  productionSteps: [],
  machineOperations: {
    total: 4,
    juicing: 2,
    seasoning: 0,
    finalizing: 2,
    blending: 0,
  },
  jarTypeSwitches: 1,
  availableJuiceJarCount: 1,
  shoppingList: [
    {
      ingredientId: 'lemon',
      name: '檸檬',
      quantity: 1,
      unitPrice: 9,
      totalCost: 9,
    },
    {
      ingredientId: 'orange',
      name: '橙子',
      quantity: 1,
      unitPrice: 11,
      totalCost: 11,
    },
  ],
  unresolvedCustomers: [],
  totalIngredientCost: 20,
  knownSalesRevenue: 0,
  knownGrossProfit: -20,
  formalSalesCount: 0,
  potentialTrialCount: 3,
  unknownFormalSalePriceCount: 0,
  producedServings: 4,
  assignedServings: 3,
  leftoverServings: 1,
}

describe('preparation demand adapter', () => {
  it('converts optimizer output into gross preparation demand', () => {
    expect(buildPreparationDemand(result)).toEqual({
      ingredients: [
        { ingredientId: 'lemon', name: '檸檬', quantity: 1 },
        { ingredientId: 'orange', name: '橙子', quantity: 1 },
      ],
      productionWaterUnits: 2,
      cleanCupUses: 3,
      producedServings: 4,
      assignedServings: 3,
      leftoverServings: 1,
      recipes: [
        {
          recipeId: 'lemon',
          recipeName: '檸檬汁',
          customerIds: ['a', 'b'],
          ingredientIds: ['lemon'],
          productionUnits: 1,
          producedServings: 2,
          assignedServings: 2,
          leftoverServings: 0,
          ingredientUnitsPerJuiceUnit: [
            { ingredientId: 'lemon', quantityPerJuiceUnit: 1 },
          ],
        },
        {
          recipeId: 'orange',
          recipeName: '橙汁',
          customerIds: ['c'],
          ingredientIds: ['orange'],
          productionUnits: 1,
          producedServings: 2,
          assignedServings: 1,
          leftoverServings: 1,
          ingredientUnitsPerJuiceUnit: [
            { ingredientId: 'orange', quantityPerJuiceUnit: 1 },
          ],
        },
      ],
    })
  })

  it('treats clean cups as uses, not unique cups owned', () => {
    const demand = buildPreparationDemand(result)
    expect(demand.cleanCupUses).toBe(result.assignedServings)
  })

  it('requires one water unit per juice unit rather than per machine operation', () => {
    const demand = buildPreparationDemand(result)
    expect(demand.productionWaterUnits).toBe(2)
    expect(demand.productionWaterUnits).not.toBe(
      result.machineOperations.total,
    )
  })
})
