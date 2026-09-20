import type { SavedRecipe } from '../types'
import type { StorageLike } from './plannerState'

export const SAVED_RECIPES_STORAGE_KEY = 'mjc-saved-recipes'

function isSavedRecipe(value: unknown): value is SavedRecipe {
  if (!value || typeof value !== 'object') return false

  const recipe = value as Partial<SavedRecipe>
  return (
    typeof recipe.id === 'string' &&
    recipe.id.length > 0 &&
    typeof recipe.name === 'string' &&
    recipe.name.length > 0 &&
    Array.isArray(recipe.ingredientIds) &&
    recipe.ingredientIds.length > 0 &&
    recipe.ingredientIds.every((id) => typeof id === 'string') &&
    typeof recipe.createdAt === 'string' &&
    (recipe.note === undefined || typeof recipe.note === 'string')
  )
}

export function readSavedRecipes(storage: StorageLike): SavedRecipe[] {
  const raw = storage.getItem(SAVED_RECIPES_STORAGE_KEY)
  if (raw === null) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    const seen = new Set<string>()
    return parsed.filter((value): value is SavedRecipe => {
      if (!isSavedRecipe(value) || seen.has(value.id)) return false
      seen.add(value.id)
      return true
    })
  } catch {
    return []
  }
}

export function writeSavedRecipes(
  storage: StorageLike,
  recipes: SavedRecipe[],
): void {
  storage.setItem(SAVED_RECIPES_STORAGE_KEY, JSON.stringify(recipes))
}

export function upsertSavedRecipe(
  recipes: SavedRecipe[],
  recipe: SavedRecipe,
): SavedRecipe[] {
  const index = recipes.findIndex((item) => item.id === recipe.id)
  if (index < 0) return [...recipes, recipe]

  const next = [...recipes]
  next[index] = recipe
  return next
}

export function removeSavedRecipe(
  recipes: SavedRecipe[],
  recipeId: string,
): SavedRecipe[] {
  return recipes.filter((recipe) => recipe.id !== recipeId)
}
