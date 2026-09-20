import { ingredients } from '../data/ingredients'
import type { RecipeCandidate } from '../types'

export const RECIPE_BATCH_YIELD = 2

export interface RecipeIngredientCost {
  batchIngredientCost: number | null
  unitIngredientCost: number | null
  missingIngredients: string[]
}

const ingredientByName = new Map(
  ingredients.map((ingredient) => [ingredient.name, ingredient]),
)

export function calculateRecipeIngredientCost(
  recipe: Pick<RecipeCandidate, 'ingredients'>,
): RecipeIngredientCost {
  const missingIngredients: string[] = []
  let batchIngredientCost = 0

  for (const ingredientName of recipe.ingredients) {
    const ingredient = ingredientByName.get(ingredientName)
    if (!ingredient) {
      missingIngredients.push(ingredientName)
      continue
    }
    batchIngredientCost += ingredient.buyPrice
  }

  if (missingIngredients.length > 0) {
    return {
      batchIngredientCost: null,
      unitIngredientCost: null,
      missingIngredients,
    }
  }

  return {
    batchIngredientCost,
    unitIngredientCost: batchIngredientCost / RECIPE_BATCH_YIELD,
    missingIngredients: [],
  }
}
