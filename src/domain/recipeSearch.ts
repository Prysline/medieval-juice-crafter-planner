import type {
  Customer,
  ProgressMilestoneId,
  RecipeCandidate,
} from '../types'
import { isAvailableAtProgress } from './availability'
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
  | 'trusted-only'
  | 'allow-unambiguous-computed'

export type ProgressiveRecipeSearchMode =
  | 'first-feasible'
  | 'bounded-exhaustive'

export interface ProgressiveRecipeSearchLayerResult {
  readonly phase: RecipeCandidateSearchPhase
  readonly seasoningDepth: number
  readonly segmentCount: number
  readonly ingredientCount: number
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
  readonly mode?: ProgressiveRecipeSearchMode
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
  if (
    options.candidatePolicy === 'trusted-only' &&
    candidate.source !== 'observed' &&
    candidate.source !== 'personal'
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

function repeatFallbackMayChangeMatch(
  customer: Customer,
  singleSegmentCandidates: readonly RecipeCandidate[],
): boolean {
  const preferences = customer.preferences ?? []
  if (!preferences.some((preference) => preference.kind === 'effect')) {
    return false
  }

  const ingredientPreferences = preferences.filter(
    (preference) => preference.kind === 'ingredient',
  )
  if (ingredientPreferences.length === 0) return true

  return singleSegmentCandidates.some((candidate) =>
    ingredientPreferences.every((preference) =>
      candidate.ingredients.includes(preference.value),
    ),
  )
}

function resultWithStop({
  candidates,
  exploredLayers,
  stoppedAt,
  usedRepeatedSeasoningFallback,
  truncated,
  guaranteedFullMatchFound = stoppedAt !== null,
}: {
  candidates: RecipeCandidate[]
  exploredLayers: ProgressiveRecipeSearchLayerResult[]
  stoppedAt: ProgressiveRecipeSearchStop | null
  usedRepeatedSeasoningFallback: boolean
  truncated: boolean
  guaranteedFullMatchFound?: boolean
}): ProgressiveRecipeSearchResult {
  return {
    candidates,
    exploredLayers,
    guaranteedFullMatchFound,
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

  if (options.candidatePolicy === 'trusted-only') {
    const candidates = pool.entries
      .filter(
        (entry) =>
          entry.availableAtCurrentProgress &&
          (
            entry.candidate.source === 'observed' ||
            entry.candidate.source === 'personal'
          ),
      )
      .map((entry) => entry.candidate)
      .filter((candidate) =>
        candidateEligibleForSearch(candidate, options),
      )

    return resultWithStop({
      candidates,
      exploredLayers: [],
      stoppedAt: null,
      usedRepeatedSeasoningFallback: false,
      truncated: false,
      guaranteedFullMatchFound: candidates.some((candidate) =>
        recipeCandidateMatchesCustomer(candidate, customer),
      ),
    })
  }

  const candidates: RecipeCandidate[] = pool.entries
    .filter(
      (entry) =>
        !entry.inGeneratedSearchScope &&
        entry.availableAtCurrentProgress &&
        candidateEligibleForSearch(entry.candidate, options),
    )
    .map((entry) => entry.candidate)
  const singleSegmentCandidates: RecipeCandidate[] = []
  const exploredLayers: ProgressiveRecipeSearchLayerResult[] = []
  const mode = options.mode ?? 'first-feasible'
  let guaranteedFullMatchFound = false
  let truncated = false

  for (const layer of pool.generatedLayers) {
    if (
      layer.phase === 'blend' &&
      !isAvailableAtProgress(
        'juice-blender-unlocked',
        currentProgress,
      )
    ) {
      continue
    }

    const layerCandidates = layer.candidateIds.flatMap((candidateId) => {
      const entry = entryById.get(candidateId)
      return entry?.availableAtCurrentProgress
        ? [entry.candidate]
        : []
    })

    candidates.push(...layerCandidates)
    if (layer.segmentCount === 1) {
      singleSegmentCandidates.push(...layerCandidates)
    }
    truncated ||= layer.truncated
    exploredLayers.push({
      phase: layer.phase,
      seasoningDepth: layer.seasoningDepth,
      segmentCount: layer.segmentCount,
      ingredientCount: layer.ingredientCount,
      candidateCount: layerCandidates.length,
      totalSequenceCount: layer.totalSequenceCount,
      truncated: layer.truncated,
    })

    const layerFullMatchFound = layerHasGuaranteedFullMatch(
      layerCandidates,
      customer,
      options,
    )
    guaranteedFullMatchFound ||= layerFullMatchFound

    if (layerFullMatchFound && mode === 'first-feasible') {
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
        guaranteedFullMatchFound,
      })
    }
  }

  if (guaranteedFullMatchFound) {
    return resultWithStop({
      candidates,
      exploredLayers,
      stoppedAt: null,
      usedRepeatedSeasoningFallback: false,
      truncated,
      guaranteedFullMatchFound: true,
    })
  }

  if (
    !repeatFallbackMayChangeMatch(
      customer,
      singleSegmentCandidates,
    )
  ) {
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
  const usedRepeatedSeasoningFallback = true
  let repeatedFallbackCandidateCount = 0

  for (
    let seasoningDepth = 2;
    seasoningDepth <= maximumRepeatedSeasoningDepth;
    seasoningDepth += 1
  ) {
    const remainingBudget =
      RECIPE_SEARCH_TOTAL_CANDIDATE_LIMIT -
      repeatedFallbackCandidateCount
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
    repeatedFallbackCandidateCount += layerCandidates.length
    truncated ||= layerTruncated
    exploredLayers.push({
      phase: generated.phase,
      seasoningDepth,
      segmentCount: generated.segmentCount,
      ingredientCount: generated.ingredientCount,
      candidateCount: layerCandidates.length,
      totalSequenceCount: generated.totalSequenceCount,
      truncated: layerTruncated,
    })

    const layerFullMatchFound = layerHasGuaranteedFullMatch(
      layerCandidates,
      customer,
      options,
    )
    guaranteedFullMatchFound ||= layerFullMatchFound

    if (layerFullMatchFound && mode === 'first-feasible') {
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
    guaranteedFullMatchFound,
  })
}
