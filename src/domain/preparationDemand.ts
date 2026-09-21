import type { OptimizationResult } from './optimizer'

export interface PreparationIngredientDemand {
  ingredientId: string
  name: string
  quantity: number
}

export interface PreparationRecipeDemand {
  recipeId: string
  recipeName: string
  batches: number
  producedServings: number
  assignedServings: number
  leftoverServings: number
}

export interface PreparationDemand {
  ingredients: PreparationIngredientDemand[]
  productionWaterUnits: number
  cleanCupUses: number
  producedServings: number
  assignedServings: number
  leftoverServings: number
  recipes: PreparationRecipeDemand[]
}

export function buildPreparationDemand(
  result: OptimizationResult,
): PreparationDemand {
  const recipeMap = new Map<string, PreparationRecipeDemand>()

  for (const batch of result.batches) {
    const current = recipeMap.get(batch.recipeId) ?? {
      recipeId: batch.recipeId,
      recipeName: batch.recipeName,
      batches: 0,
      producedServings: 0,
      assignedServings: 0,
      leftoverServings: 0,
    }

    current.batches += 1
    current.producedServings += 2
    current.assignedServings += batch.customerIds.length
    current.leftoverServings =
      current.producedServings - current.assignedServings

    recipeMap.set(batch.recipeId, current)
  }

  return {
    ingredients: result.shoppingList.map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      quantity: item.quantity,
    })),
    productionWaterUnits: result.batches.length,
    cleanCupUses: result.assignedServings,
    producedServings: result.producedServings,
    assignedServings: result.assignedServings,
    leftoverServings: result.leftoverServings,
    recipes: [...recipeMap.values()],
  }
}
