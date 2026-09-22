import type {
  Customer,
  ProgressMilestoneId,
  RecipeCandidate,
} from '../types'
import { recipeCandidateMatchesCustomer } from './matching'
import type { RecipeCandidatePool } from './recipeCandidatePool'
import {
  MAX_REPEATED_RECIPE_INGREDIENT_COUNT,
  RECIPE_SEARCH_TOTAL_CANDIDATE_LIMIT,
  generateRepeatedSeasoningCandidateLayer,
  type RecipeCandidateSearchPhase,
} from './recipeGenerator'

export type ProgressiveRecipeSearchPolicy =
  | 'observed-only'
  | 'allow-unambiguous-computed'

export interface ProgressiveRecipeSearchLayerResult {
  readonly phase: RecipeCandidateSearchPhase
  readonly seasoningDepth: number
  readonly candidateCount: number
  readonly totalSequenceCount: number
  readonly truncated: boolean
}

export interface ProgressiveRecipeSearchStop {
  readonly phase: RecipeCandidateSearchPhase
  readonly seasoningDepth: number
}

export interface ProgressiveRecipeSearchResult {
  readonly candidates: readonly RecipeCandidate[]
  readonly exploredLayers: readonly ProgressiveRecipeSearchLayerResult[]
  readonly guaranteedFullMatchFound: boolean
  readonly stoppedAt: ProgressiveRecipeSearchStop | null
  readonly usedRepeatedSeasoningFallback: boolean
  readonly truncated: boolean
}

export interface ProgressiveRecipeSearchOptions {
  readonly candidatePolicy: ProgressiveRecipeSearchPolicy
  readonly additionalCandidateEligibility?: (
    candidate: RecipeCandidate,
  ) => boolean
}

function candidateEligibleForSearch(
  candidate: RecipeCandidate,
  options: ProgressiveRecipeSearchOptions,
): boolean {
  if (candidate.effectAmbiguity) return false
  if (
    options.candidatePolicy === 'observed-only' &&
    candidate.source !== 'observed'
  ) {
    return false
  }

  return options.additionalCandidateEligibility?.(candidate) ?? true
}

function layerHasGuaranteedFullMatch(
  candidates: readonly RecipeCandidate[],
  customer: Customer,
  options: ProgressiveRecipeSearchOptions,
): boolean {
  return candidates.some(
    (candidate) =>
      candidateEligibleForSearch(candidate, options) &&
      recipeCandidateMatchesCustomer(candidate, customer),
  )
}

function repeatFallbackMayChangeMatch(customer: Customer): boolean {
  return (
    customer.preferences?.some(
      (preference) => preference.kind === 'effect',
    ) ?? false
  )
}

function resultWithStop({
  candidates,
  exploredLayers,
  stoppedAt,
  usedRepeatedSeasoningFallback,
  truncated,
}: {
  candidates: RecipeCandidate[]
  exploredLayers: ProgressiveRecipeSearchLayerResult[]
  stoppedAt: ProgressiveRecipeSearchStop | null
  usedRepeatedSeasoningFallback: boolean
  truncated: boolean
}): ProgressiveRecipeSearchResult {
  return {
    candidates,
    exploredLayers,
    guaranteedFullMatchFound: stoppedAt !== null,
    stoppedAt,
    usedRepeatedSeasoningFallback,
    truncated,
  }
}

export function searchRecipeCandidatesForCustomer(
  pool: RecipeCandidatePool,
  currentProgress: ProgressMilestoneId,
  customer: Customer,
  options: ProgressiveRecipeSearchOptions,
): ProgressiveRecipeSearchResult {
  const entryById = new Map(
    pool.entries.map((entry) => [entry.id, entry]),
  )
  const candidates: RecipeCandidate[] = []
  const exploredLayers: ProgressiveRecipeSearchLayerResult[] = []
  let truncated = false

  for (const layer of pool.generatedLayers) {
    const layerCandidates = layer.candidateIds.flatMap((candidateId) => {
      const entry = entryById.get(candidateId)
      return entry?.availableAtCurrentProgress
        ? [entry.candidate]
        : []
    })

    candidates.push(...layerCandidates)
    truncated ||= layer.truncated
    exploredLayers.push({
      phase: layer.phase,
      seasoningDepth: layer.seasoningDepth,
      candidateCount: layerCandidates.length,
      totalSequenceCount: layer.totalSequenceCount,
      truncated: layer.truncated,
    })

    if (
      layerHasGuaranteedFullMatch(
        layerCandidates,
        customer,
        options,
      )
    ) {
      return resultWithStop({
        candidates,
        exploredLayers,
        stoppedAt: {
          phase: layer.phase,
          seasoningDepth: layer.seasoningDepth,
        },
        usedRepeatedSeasoningFallback: false,
        truncated,
      })
    }

    if (layer.truncated) {
      return resultWithStop({
        candidates,
        exploredLayers,
        stoppedAt: null,
        usedRepeatedSeasoningFallback: false,
        truncated: true,
      })
    }
  }

  if (!repeatFallbackMayChangeMatch(customer)) {
    return resultWithStop({
      candidates,
      exploredLayers,
      stoppedAt: null,
      usedRepeatedSeasoningFallback: false,
      truncated,
    })
  }

  const maximumRepeatedSeasoningDepth =
    MAX_REPEATED_RECIPE_INGREDIENT_COUNT - 1
  let usedRepeatedSeasoningFallback = true

  for (
    let seasoningDepth = 2;
    seasoningDepth <= maximumRepeatedSeasoningDepth;
    seasoningDepth += 1
  ) {
    const remainingBudget =
      RECIPE_SEARCH_TOTAL_CANDIDATE_LIMIT - candidates.length
    if (remainingBudget <= 0) {
      truncated = true
      break
    }

    const generated = generateRepeatedSeasoningCandidateLayer(
      currentProgress,
      seasoningDepth,
    )
    const layerCandidates = generated.candidates.slice(
      0,
      remainingBudget,
    )
    const layerTruncated =
      generated.truncated ||
      layerCandidates.length < generated.candidates.length

    candidates.push(...layerCandidates)
    truncated ||= layerTruncated
    exploredLayers.push({
      phase: generated.phase,
      seasoningDepth,
      candidateCount: layerCandidates.length,
      totalSequenceCount: generated.totalSequenceCount,
      truncated: layerTruncated,
    })

    if (
      layerHasGuaranteedFullMatch(
        layerCandidates,
        customer,
        options,
      )
    ) {
      return resultWithStop({
        candidates,
        exploredLayers,
        stoppedAt: {
          phase: generated.phase,
          seasoningDepth,
        },
        usedRepeatedSeasoningFallback,
        truncated,
      })
    }

    if (layerTruncated) break
  }

  return resultWithStop({
    candidates,
    exploredLayers,
    stoppedAt: null,
    usedRepeatedSeasoningFallback,
    truncated,
  })
}
