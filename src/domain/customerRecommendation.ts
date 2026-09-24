import { recipeCandidateMatchesCustomer } from './matching'
import { calculateRecipeIngredientCost } from './recipeCost'
import type { ProgressiveRecipeSearchPolicy } from './recipeSearch'
import type { Customer, RecipeCandidate } from '../types'

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
