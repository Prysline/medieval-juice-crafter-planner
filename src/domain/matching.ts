import type { Customer, Preference, Recipe, StageId } from '../types'

export type MatchLevel = 'full' | 'partial' | 'none'

function preferenceMatchesRecipe(recipe: Recipe, preference: Preference): boolean {
  if (preference.kind === 'ingredient') {
    return recipe.ingredients.includes(preference.value)
  }

  return recipe.effects.includes(preference.value)
}

export function recipeMatchLevel(recipe: Recipe, customer: Customer): MatchLevel {
  if (customer.preferences.length === 0) return 'none'

  const matchedCount = customer.preferences.filter((preference) =>
    preferenceMatchesRecipe(recipe, preference),
  ).length

  if (matchedCount === customer.preferences.length) return 'full'
  if (matchedCount > 0) return 'partial'
  return 'none'
}

/**
 * Default acceptance rule.
 *
 * Potential customers require a sample that satisfies every known preference
 * before they become formal customers, so the planner treats only full matches
 * as acceptable by default.
 */
export function recipeMatchesCustomer(recipe: Recipe, customer: Customer): boolean {
  return recipeMatchLevel(recipe, customer) === 'full'
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

export function partialMatchingRecipesForCustomer(
  recipes: Recipe[],
  customer: Customer,
  stage: StageId,
): Recipe[] {
  return availableRecipes(recipes, stage)
    .filter((recipe) => recipeMatchLevel(recipe, customer) === 'partial')
    .sort((a, b) => b.salePrice - a.salePrice || a.name.localeCompare(b.name, 'zh-Hant'))
}

export function customerIsUnlocked(customer: Customer, satisfaction: number): boolean {
  return satisfaction >= customer.satisfactionRequired
}
