import { recipeCandidateMatchesCustomer } from './matching'
import { calculateRecipeIngredientCost } from './recipeCost'
import type { ProgressiveRecipeSearchPolicy } from './recipeSearch'
import type { Customer, RecipeCandidate } from '../types'

export type RecommendationPolicy = ProgressiveRecipeSearchPolicy

export interface CostedRecipeCandidate {
  candidate: RecipeCandidate
  batchIngredientCost: number
  unitIngredientCost: number
}

export interface CheapestRecipeRecommendation {
  policy: RecommendationPolicy
  batchIngredientCost: number
  unitIngredientCost: number
  candidates: CostedRecipeCandidate[]
}

export interface CustomerRecipeRecommendations {
  observedOnly: CheapestRecipeRecommendation | null
  allowComputed: CheapestRecipeRecommendation | null
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

export function cheapestFullMatchRecommendation(
  candidates: readonly RecipeCandidate[],
  customer: Customer,
  policy: RecommendationPolicy,
): CheapestRecipeRecommendation | null {
  const costed = candidates.flatMap((candidate) => {
    if (!eligibleForPolicy(candidate, policy)) return []
    if (!recipeCandidateMatchesCustomer(candidate, customer)) return []

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

  if (costed.length === 0) return null

  const minimumBatchCost = Math.min(
    ...costed.map((item) => item.batchIngredientCost),
  )
  const cheapest = costed.filter(
    (item) => item.batchIngredientCost === minimumBatchCost,
  )

  return {
    policy,
    batchIngredientCost: minimumBatchCost,
    unitIngredientCost: cheapest[0].unitIngredientCost,
    candidates: cheapest,
  }
}

export function customerRecipeRecommendationsFromSearch(
  observedOnlyCandidates: readonly RecipeCandidate[],
  allowComputedCandidates: readonly RecipeCandidate[],
  customer: Customer,
): CustomerRecipeRecommendations {
  return {
    observedOnly: cheapestFullMatchRecommendation(
      observedOnlyCandidates,
      customer,
      'observed-only',
    ),
    allowComputed: cheapestFullMatchRecommendation(
      allowComputedCandidates,
      customer,
      'allow-unambiguous-computed',
    ),
  }
}

export function customerRecipeRecommendations(
  candidates: readonly RecipeCandidate[],
  customer: Customer,
): CustomerRecipeRecommendations {
  return customerRecipeRecommendationsFromSearch(
    candidates,
    candidates,
    customer,
  )
}
