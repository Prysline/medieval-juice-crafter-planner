import { recipeIsAvailable } from './availability'
import type {
  Customer,
  Preference,
  ProgressMilestoneId,
  Recipe,
  RecipeCandidate,
} from '../types'

export type MatchLevel = 'full' | 'partial' | 'none'

type MatchableRecipe = Pick<RecipeCandidate, 'ingredients' | 'effects'>

function preferenceMatchesRecipe(
  recipe: MatchableRecipe,
  preference: Preference,
): boolean {
  if (preference.kind === 'ingredient') {
    return recipe.ingredients.includes(preference.value)
  }

  return recipe.effects.some((effect) => effect.name === preference.value)
}

function matchLevel(
  recipe: MatchableRecipe,
  customer: Customer,
): MatchLevel {
  if (!customer.preferences || customer.preferences.length === 0) return 'none'

  const matchedCount = customer.preferences.filter((preference) =>
    preferenceMatchesRecipe(recipe, preference),
  ).length

  if (matchedCount === customer.preferences.length) return 'full'
  if (matchedCount > 0) return 'partial'
  return 'none'
}

export function recipeMatchLevel(recipe: Recipe, customer: Customer): MatchLevel {
  return matchLevel(recipe, customer)
}

export function recipeMatchesCustomer(recipe: Recipe, customer: Customer): boolean {
  return recipeMatchLevel(recipe, customer) === 'full'
}

export function recipeCandidateMatchLevel(
  candidate: RecipeCandidate,
  customer: Customer,
): MatchLevel {
  return matchLevel(candidate, customer)
}

export function recipeCandidateMatchesCustomer(
  candidate: RecipeCandidate,
  customer: Customer,
): boolean {
  if (candidate.effectAmbiguity) return false
  return recipeCandidateMatchLevel(candidate, customer) === 'full'
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
    .sort(
      (a, b) =>
        b.salePrice - a.salePrice ||
        a.name.localeCompare(b.name, 'zh-Hant'),
    )
}

export function partialMatchingRecipesForCustomer(
  recipes: Recipe[],
  customer: Customer,
  currentProgress: ProgressMilestoneId,
): Recipe[] {
  return availableRecipes(recipes, currentProgress)
    .filter((recipe) => recipeMatchLevel(recipe, customer) === 'partial')
    .sort(
      (a, b) =>
        b.salePrice - a.salePrice ||
        a.name.localeCompare(b.name, 'zh-Hant'),
    )
}

export function matchingRecipeCandidatesForCustomer(
  candidates: RecipeCandidate[],
  customer: Customer,
): RecipeCandidate[] {
  return candidates
    .filter((candidate) => recipeCandidateMatchesCustomer(candidate, customer))
    .sort((a, b) => {
      if (a.salePrice === null && b.salePrice === null) {
        return a.name.localeCompare(b.name, 'zh-Hant')
      }
      if (a.salePrice === null) return 1
      if (b.salePrice === null) return -1
      return (
        b.salePrice - a.salePrice ||
        a.name.localeCompare(b.name, 'zh-Hant')
      )
    })
}
