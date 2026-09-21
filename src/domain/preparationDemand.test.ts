import { describe, expect, it } from 'vitest'
import type { OptimizationResult } from './optimizer'
import { buildPreparationDemand } from './preparationDemand'

const result: OptimizationResult = {
  assignments: [
    { customerId: 'a', recipeId: 'lemon' },
    { customerId: 'b', recipeId: 'lemon' },
    { customerId: 'c', recipeId: 'orange' },
  ],
  batches: [
    {
      recipeId: 'lemon',
      recipeName: '檸檬汁',
      batchNumber: 1,
      customerIds: ['a', 'b'],
      batchIngredientCost: 9,
    },
    {
      recipeId: 'orange',
      recipeName: '橙汁',
      batchNumber: 1,
      customerIds: ['c'],
      batchIngredientCost: 11,
    },
  ],
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
          batches: 1,
          producedServings: 2,
          assignedServings: 2,
          leftoverServings: 0,
        },
        {
          recipeId: 'orange',
          recipeName: '橙汁',
          batches: 1,
          producedServings: 2,
          assignedServings: 1,
          leftoverServings: 1,
        },
      ],
    })
  })

  it('treats clean cups as uses, not unique cups owned', () => {
    const demand = buildPreparationDemand(result)
    expect(demand.cleanCupUses).toBe(result.assignedServings)
  })

  it('requires one production water unit per selected batch', () => {
    const demand = buildPreparationDemand(result)
    expect(demand.productionWaterUnits).toBe(result.batches.length)
  })
})
