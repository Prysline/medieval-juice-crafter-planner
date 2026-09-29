import { isAvailableAtProgress } from './availability'
import {
  recipeCandidateMatchesCustomer,
  recipeMatchesCustomer,
} from './matching'
import { calculateRecipeIngredientCost } from './recipeCost'
import type { ProgressiveRecipeSearchPolicy } from './recipeSearch'
import type {
  Customer,
  ProgressMilestoneId,
  Recipe,
  RecipeCandidate,
} from '../types'

export type RecommendationPolicy = ProgressiveRecipeSearchPolicy
export type RecommendationCostMode = 'minimum' | 'maximum'

export interface CostedRecipeCandidate {
  candidate: RecipeCandidate
  batchIngredientCost: number
  unitIngredientCost: number
}

export interface BestRecipeRecommendation {
  policy: RecommendationPolicy
  costMode: RecommendationCostMode
  batchIngredientCost: number
  unitIngredientCost: number
  candidates: CostedRecipeCandidate[]
}

export type CheapestRecipeRecommendation = BestRecipeRecommendation

export interface CustomerRecipeRecommendations {
  observedOnly: BestRecipeRecommendation | null
  allowComputed: BestRecipeRecommendation | null
}

export type CustomerFullMatchAvailabilityKind =
  | 'observed-current'
  | 'safe-current'
  | 'future-observed'
  | 'ambiguous-only'
  | 'none-in-search-scope'

export interface CustomerFullMatchAvailability {
  kind: CustomerFullMatchAvailabilityKind
  currentSources: readonly RecipeCandidate['source'][]
  futureObservedMatches: readonly Recipe[]
  ambiguousCandidates: readonly RecipeCandidate[]
  searchTruncated: boolean
}

export interface RecommendationDisplayItem extends CostedRecipeCandidate {
  reasons: readonly string[]
}

function ambiguousCandidateCouldMatchCustomer(
  candidate: RecipeCandidate,
  customer: Customer,
): boolean {
  const ambiguity = candidate.effectAmbiguity
  const preferences = customer.preferences
  if (!ambiguity || !preferences || preferences.length === 0) {
    return false
  }

  const confirmedEffectNames = new Set(
    candidate.effects.map((effect) => effect.name),
  )
  const ambiguousEffectNames = new Set(
    ambiguity.candidates.map((effect) => effect.name),
  )
  const requiredAmbiguousEffects = new Set<string>()

  for (const preference of preferences) {
    if (preference.kind === 'ingredient') {
      if (!candidate.ingredients.includes(preference.value)) {
        return false
      }
      continue
    }

    if (confirmedEffectNames.has(preference.value)) continue
    if (!ambiguousEffectNames.has(preference.value)) return false
    requiredAmbiguousEffects.add(preference.value)
  }

  return requiredAmbiguousEffects.size <= ambiguity.remainingSlots
}

export function customerFullMatchAvailability({
  customer,
  currentProgress,
  currentFullMatches,
  searchedCandidates,
  knownObservedRecipes,
  searchTruncated,
}: {
  customer: Customer
  currentProgress: ProgressMilestoneId
  currentFullMatches: readonly RecipeCandidate[]
  searchedCandidates: readonly RecipeCandidate[]
  knownObservedRecipes: readonly Recipe[]
  searchTruncated: boolean
}): CustomerFullMatchAvailability {
  const currentSources = (
    ['observed', 'personal', 'computed'] as const
  ).filter((source) =>
    currentFullMatches.some((candidate) => candidate.source === source),
  )

  if (currentSources.includes('observed')) {
    return {
      kind: 'observed-current',
      currentSources,
      futureObservedMatches: [],
      ambiguousCandidates: [],
      searchTruncated,
    }
  }

  if (currentFullMatches.length > 0) {
    return {
      kind: 'safe-current',
      currentSources,
      futureObservedMatches: [],
      ambiguousCandidates: [],
      searchTruncated,
    }
  }

  const futureObservedMatches = knownObservedRecipes.filter(
    (recipe) =>
      !isAvailableAtProgress(recipe.unlockedAt, currentProgress) &&
      recipeMatchesCustomer(recipe, customer),
  )
  if (futureObservedMatches.length > 0) {
    return {
      kind: 'future-observed',
      currentSources: [],
      futureObservedMatches,
      ambiguousCandidates: [],
      searchTruncated,
    }
  }

  const ambiguousCandidates = searchedCandidates.filter((candidate) =>
    ambiguousCandidateCouldMatchCustomer(candidate, customer),
  )
  if (ambiguousCandidates.length > 0) {
    return {
      kind: 'ambiguous-only',
      currentSources: [],
      futureObservedMatches: [],
      ambiguousCandidates,
      searchTruncated,
    }
  }

  return {
    kind: 'none-in-search-scope',
    currentSources: [],
    futureObservedMatches: [],
    ambiguousCandidates: [],
    searchTruncated,
  }
}

export function recommendationDisplayItems(
  recommendations: CustomerRecipeRecommendations,
): RecommendationDisplayItem[] {
  const byCandidateId = new Map<string, RecommendationDisplayItem>()

  function addRecommendation(
    recommendation: BestRecipeRecommendation | null,
    reasonPrefix: string,
  ) {
    if (!recommendation) return
    const costLabel =
      recommendation.costMode === 'minimum' ? '最低成本' : '最高成本'
    const reason = `${reasonPrefix}${costLabel}`

    for (const item of recommendation.candidates) {
      const current = byCandidateId.get(item.candidate.id)
      if (current) {
        if (!current.reasons.includes(reason)) {
          byCandidateId.set(item.candidate.id, {
            ...current,
            reasons: [...current.reasons, reason],
          })
        }
        continue
      }

      byCandidateId.set(item.candidate.id, {
        ...item,
        reasons: [reason],
      })
    }
  }

  addRecommendation(recommendations.observedOnly, '已實測')
  addRecommendation(recommendations.allowComputed, '目前可製作')

  return [...byCandidateId.values()]
}

function eligibleForPolicy(
  candidate: RecipeCandidate,
  policy: RecommendationPolicy,
): boolean {
  if (candidate.effectAmbiguity) return false
  if (policy === 'observed-only' && candidate.source !== 'observed') {
    return false
  }
  return true
}

function usesUniqueIngredients(candidate: RecipeCandidate): boolean {
  return new Set(candidate.ingredients).size === candidate.ingredients.length
}

function preferUniqueIngredientsForMaximumCost(
  candidates: readonly RecipeCandidate[],
  costMode: RecommendationCostMode,
): RecipeCandidate[] {
  if (costMode !== 'maximum') return [...candidates]

  const uniqueCandidates = candidates.filter(usesUniqueIngredients)
  return uniqueCandidates.length > 0 ? uniqueCandidates : [...candidates]
}

function costedFullMatches(
  candidates: readonly RecipeCandidate[],
  customer: Customer,
  policy: RecommendationPolicy,
  costMode: RecommendationCostMode,
): CostedRecipeCandidate[] {
  const fullMatches = candidates.filter(
    (candidate) =>
      eligibleForPolicy(candidate, policy) &&
      recipeCandidateMatchesCustomer(candidate, customer),
  )
  const preferredMatches = preferUniqueIngredientsForMaximumCost(
    fullMatches,
    costMode,
  )

  return preferredMatches.flatMap((candidate) => {
    const cost = calculateRecipeIngredientCost(candidate)
    if (
      cost.batchIngredientCost === null ||
      cost.unitIngredientCost === null
    ) {
      return []
    }

    return [{
      candidate,
      batchIngredientCost: cost.batchIngredientCost,
      unitIngredientCost: cost.unitIngredientCost,
    }]
  })
}

export function bestFullMatchRecommendation(
  candidates: readonly RecipeCandidate[],
  customer: Customer,
  policy: RecommendationPolicy,
  costMode: RecommendationCostMode,
): BestRecipeRecommendation | null {
  const costed = costedFullMatches(
    candidates,
    customer,
    policy,
    costMode,
  )
  if (costed.length === 0) return null

  const targetBatchCost =
    costMode === 'minimum'
      ? Math.min(...costed.map((item) => item.batchIngredientCost))
      : Math.max(...costed.map((item) => item.batchIngredientCost))
  const best = costed.filter(
    (item) => item.batchIngredientCost === targetBatchCost,
  )

  return {
    policy,
    costMode,
    batchIngredientCost: targetBatchCost,
    unitIngredientCost: best[0].unitIngredientCost,
    candidates: best,
  }
}

export function cheapestFullMatchRecommendation(
  candidates: readonly RecipeCandidate[],
  customer: Customer,
  policy: RecommendationPolicy,
): BestRecipeRecommendation | null {
  return bestFullMatchRecommendation(
    candidates,
    customer,
    policy,
    'minimum',
  )
}

export function sortFullMatchCandidatesByIngredientCost(
  candidates: readonly RecipeCandidate[],
  costMode: RecommendationCostMode,
): RecipeCandidate[] {
  return preferUniqueIngredientsForMaximumCost(candidates, costMode)
    .map((candidate, index) => ({
      candidate,
      index,
      cost: calculateRecipeIngredientCost(candidate).batchIngredientCost,
    }))
    .sort((left, right) => {
      if (left.cost === null && right.cost === null) {
        return left.index - right.index
      }
      if (left.cost === null) return 1
      if (right.cost === null) return -1

      const costDelta =
        costMode === 'minimum'
          ? left.cost - right.cost
          : right.cost - left.cost
      return costDelta || left.index - right.index
    })
    .map(({ candidate }) => candidate)
}

export function customerRecipeRecommendationsFromSearch(
  observedOnlyCandidates: readonly RecipeCandidate[],
  allowComputedCandidates: readonly RecipeCandidate[],
  customer: Customer,
  costMode: RecommendationCostMode = 'minimum',
): CustomerRecipeRecommendations {
  return {
    observedOnly: bestFullMatchRecommendation(
      observedOnlyCandidates,
      customer,
      'observed-only',
      costMode,
    ),
    allowComputed: bestFullMatchRecommendation(
      allowComputedCandidates,
      customer,
      'allow-unambiguous-computed',
      costMode,
    ),
  }
}

export function customerRecipeRecommendations(
  candidates: readonly RecipeCandidate[],
  customer: Customer,
  costMode: RecommendationCostMode = 'minimum',
): CustomerRecipeRecommendations {
  return customerRecipeRecommendationsFromSearch(
    candidates,
    candidates,
    customer,
    costMode,
  )
}
