import { recipeIsAvailable } from './availability'
import type {
  Customer,
  Preference,
  ProgressMilestoneId,
  Recipe,
} from '../types'

export type MatchLevel = 'full' | 'partial' | 'none'

function preferenceMatchesRecipe(recipe: Recipe, preference: Preference): boolean {
  if (preference.kind === 'ingredient') {
    return recipe.ingredients.includes(preference.value)
  }

  return recipe.effects.some((effect) => effect.name === preference.value)
}

export function recipeMatchLevel(recipe: Recipe, customer: Customer): MatchLevel {
  if (!customer.preferences || customer.preferences.length === 0) return 'none'

  const matchedCount = customer.preferences.filter((preference) =>
    preferenceMatchesRecipe(recipe, preference),
  ).length

  if (matchedCount === customer.preferences.length) return 'full'
  if (matchedCount > 0) return 'partial'
  return 'none'
}

export function recipeMatchesCustomer(recipe: Recipe, customer: Customer): boolean {
  return recipeMatchLevel(recipe, customer) === 'full'
}

export function availableRecipes(
  recipes: Recipe[],
  currentProgress: ProgressMilestoneId,
): Recipe[] {
  return recipes.filter((recipe) => recipeIsAvailable(recipe, currentProgress))
}

export function matchingRecipesForCustomer(
  recipes: Recipe[],
  customer: Customer,
  currentProgress: ProgressMilestoneId,
): Recipe[] {
  return availableRecipes(recipes, currentProgress)
    .filter((recipe) => recipeMatchesCustomer(recipe, customer))
    .sort((a, b) => b.salePrice - a.salePrice || a.name.localeCompare(b.name, 'zh-Hant'))
}

export function partialMatchingRecipesForCustomer(
  recipes: Recipe[],
  customer: Customer,
  currentProgress: ProgressMilestoneId,
): Recipe[] {
  return availableRecipes(recipes, currentProgress)
    .filter((recipe) => recipeMatchLevel(recipe, customer) === 'partial')
    .sort((a, b) => b.salePrice - a.salePrice || a.name.localeCompare(b.name, 'zh-Hant'))
}
