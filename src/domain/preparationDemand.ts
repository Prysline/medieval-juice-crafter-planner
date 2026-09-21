import type { OptimizationResult } from './optimizer'

export interface PreparationIngredientDemand {
  ingredientId: string
  name: string
  quantity: number
}

export interface PreparationRecipeIngredient {
  ingredientId: string
  quantityPerJuiceUnit: number
}

export interface PreparationRecipeDemand {
  recipeId: string
  recipeName: string
  /** Customers already assigned by the optimizer through the full-match gate. */
  customerIds: string[]
  productionUnits: number
  producedServings: number
  assignedServings: number
  leftoverServings: number
  ingredientUnitsPerJuiceUnit: PreparationRecipeIngredient[]
}

export interface PreparationDemand {
  ingredients: PreparationIngredientDemand[]
  /** Water uses are per juice unit, not per machine operation. */
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
  return {
    ingredients: result.shoppingList.map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      quantity: item.quantity,
    })),
    productionWaterUnits: result.recipePlans.reduce(
      (sum, recipe) => sum + recipe.juiceUnits,
      0,
    ),
    cleanCupUses: result.assignedServings,
    producedServings: result.producedServings,
    assignedServings: result.assignedServings,
    leftoverServings: result.leftoverServings,
    recipes: result.recipePlans.map((recipe) => {
      const ingredientUnitsPerJuiceUnit = [
        ...new Set(recipe.ingredientIds),
      ].map((ingredientId) => ({
        ingredientId,
        quantityPerJuiceUnit: recipe.ingredientIds.filter(
          (id) => id === ingredientId,
        ).length,
      }))

      return {
        recipeId: recipe.recipeId,
        recipeName: recipe.recipeName,
        customerIds: [...recipe.customerIds],
        productionUnits: recipe.juiceUnits,
        producedServings: recipe.producedServings,
        assignedServings: recipe.assignedServings,
        leftoverServings: recipe.leftoverServings,
        ingredientUnitsPerJuiceUnit,
      }
    }),
  }
}
