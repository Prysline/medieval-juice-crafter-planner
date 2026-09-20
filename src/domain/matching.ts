import type { Customer, Recipe, StageId } from '../types'

export function recipeMatchesCustomer(recipe: Recipe, customer: Customer): boolean {
  return customer.preferences.some((preference) => {
    if (preference.kind === 'ingredient') {
      return recipe.ingredients.includes(preference.value)
    }

    return recipe.effects.includes(preference.value)
  })
}

export function availableRecipes(recipes: Recipe[], stage: StageId): Recipe[] {
  return recipes.filter((recipe) => recipe.stage <= stage)
}

export function matchingRecipesForCustomer(
  recipes: Recipe[],
  customer: Customer,
  stage: StageId,
): Recipe[] {
  return availableRecipes(recipes, stage)
    .filter((recipe) => recipeMatchesCustomer(recipe, customer))
    .sort((a, b) => b.salePrice - a.salePrice || a.name.localeCompare(b.name, 'zh-Hant'))
}

export function customerIsUnlocked(customer: Customer, satisfaction: number): boolean {
  return satisfaction >= customer.satisfactionRequired
}
