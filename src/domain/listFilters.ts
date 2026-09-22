import type { Customer, VillageId } from '../types'
import type {
  RecipeCandidatePoolEntry,
  RecipeCandidatePoolSource,
} from './recipeCandidatePool'

export type FilterMatchMode = 'all' | 'any'
export type RecipePriceFilter = 'all' | 'known' | 'unknown'
export type RecipeSourceFilter = 'all' | RecipeCandidatePoolSource

export interface CustomerResearchFilters {
  villageId: VillageId | null
  preferenceIngredient: string | null
  preferenceEffect: string | null
  preferenceMode: FilterMatchMode
}

export interface RecipeResearchFilters {
  ingredientCount: number | null
  ingredientId: string | null
  confirmedEffect: string | null
  possibleEffect: string | null
  source: RecipeSourceFilter
  price: RecipePriceFilter
}

export function customerMatchesResearchFilters(
  customer: Customer,
  filters: CustomerResearchFilters,
): boolean {
  if (filters.villageId && customer.villageId !== filters.villageId) {
    return false
  }

  const preferenceChecks: boolean[] = []
  if (filters.preferenceIngredient) {
    preferenceChecks.push(
      Boolean(
        customer.preferences?.some(
          (preference) =>
            preference.kind === 'ingredient' &&
            preference.value === filters.preferenceIngredient,
        ),
      ),
    )
  }
  if (filters.preferenceEffect) {
    preferenceChecks.push(
      Boolean(
        customer.preferences?.some(
          (preference) =>
            preference.kind === 'effect' &&
            preference.value === filters.preferenceEffect,
        ),
      ),
    )
  }

  if (preferenceChecks.length === 0) return true
  return filters.preferenceMode === 'all'
    ? preferenceChecks.every(Boolean)
    : preferenceChecks.some(Boolean)
}

export function recipeEntryMatchesResearchFilters(
  entry: RecipeCandidatePoolEntry,
  filters: RecipeResearchFilters,
): boolean {
  const candidate = entry.candidate

  if (
    filters.ingredientCount !== null &&
    entry.ingredientIds.length !== filters.ingredientCount
  ) {
    return false
  }

  if (
    filters.ingredientId &&
    !entry.ingredientIds.includes(filters.ingredientId)
  ) {
    return false
  }

  if (
    filters.confirmedEffect &&
    !candidate.effects.some(
      (effect) => effect.name === filters.confirmedEffect,
    )
  ) {
    return false
  }

  if (
    filters.possibleEffect &&
    !candidate.effectAmbiguity?.candidates.some(
      (effect) => effect.name === filters.possibleEffect,
    )
  ) {
    return false
  }

  if (
    filters.source !== 'all' &&
    !entry.sources.includes(filters.source)
  ) {
    return false
  }

  if (filters.price === 'known' && candidate.salePrice === null) {
    return false
  }
  if (filters.price === 'unknown' && candidate.salePrice !== null) {
    return false
  }

  return true
}
