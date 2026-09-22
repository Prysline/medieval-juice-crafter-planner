import { ingredientIsAvailable } from './availability'
import {
  effectSlotCount,
  evaluateRecipeSequence,
  predictRecipeEffects,
} from './recipeEvaluator'
import { ingredients } from '../data/ingredients'
import {
  recipeIngredientCapabilities,
  type RecipeIngredientCapability,
} from '../data/recipeIngredientCapabilities'
import type {
  Ingredient,
  ProgressMilestoneId,
  RecipeCandidate,
} from '../types'

export const MAX_UNIQUE_INGREDIENT_COUNT = 4
export const MAX_REPEATED_RECIPE_INGREDIENT_COUNT = 6
export const RECIPE_SEARCH_LAYER_CANDIDATE_LIMIT = 2048
export const RECIPE_SEARCH_TOTAL_CANDIDATE_LIMIT = 4096

export const MAX_BLEND_SEGMENT_COUNT = 3
export const MAX_BLEND_DEPTH = MAX_BLEND_SEGMENT_COUNT - 1
export const BLEND_SEARCH_LAYER_CANDIDATE_LIMIT = 6000
export const BLEND_SEARCH_TOTAL_CANDIDATE_LIMIT = 11000

const MAX_BLEND_TOTAL_SEASONING_DEPTH_BY_SEGMENT_COUNT = {
  2: 4,
  3: 2,
} as const

export type RecipeCandidateSearchPhase =
  | 'unique'
  | 'blend'
  | 'repeat-fallback'

export interface RecipeCandidateGenerationLayer {
  readonly phase: RecipeCandidateSearchPhase
  readonly seasoningDepth: number
  readonly segmentCount: number
  readonly ingredientCount: number
  readonly candidates: readonly RecipeCandidate[]
  readonly totalSequenceCount: number
  readonly truncated: boolean
}

const ingredientById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient]),
)

function compareIds(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function capabilityIngredient(
  capability: RecipeIngredientCapability,
): Ingredient {
  const ingredient = ingredientById.get(capability.ingredientId)
  if (!ingredient) {
    throw new Error(
      `Missing ingredient for recipe capability: ${capability.ingredientId}`,
    )
  }
  return ingredient
}

function evaluatedCandidate(
  ingredientIds: string[],
  currentProgress: ProgressMilestoneId,
): RecipeCandidate {
  const evaluation = evaluateRecipeSequence(ingredientIds, currentProgress)
  if (!evaluation.valid) {
    throw new Error(
      `Generator produced invalid sequence: ${ingredientIds.join(' -> ')}`,
    )
  }
  return evaluation.candidate
}

function availableSingleSegmentCapabilities(
  currentProgress: ProgressMilestoneId,
): {
  bases: RecipeIngredientCapability[]
  seasonings: RecipeIngredientCapability[]
} {
  const availableCapabilities = recipeIngredientCapabilities
    .filter((capability) =>
      ingredientIsAvailable(
        capabilityIngredient(capability),
        currentProgress,
      ),
    )
    .sort((left, right) =>
      compareIds(left.ingredientId, right.ingredientId),
    )

  return {
    bases: availableCapabilities.filter((capability) =>
      capability.roles.includes('juice-base'),
    ),
    seasonings: availableCapabilities.filter((capability) =>
      capability.roles.includes('seasoning'),
    ),
  }
}

function permutationCount(
  optionCount: number,
  depth: number,
): number {
  if (depth > optionCount) return 0
  let result = 1
  for (let index = 0; index < depth; index += 1) {
    result *= optionCount - index
  }
  return result
}

function seasoningTailCount(
  seasoningCount: number,
  depth: number,
  allowRepeats: boolean,
): number {
  if (!allowRepeats) {
    return permutationCount(seasoningCount, depth)
  }
  return (
    seasoningCount ** depth -
    permutationCount(seasoningCount, depth)
  )
}

function collectSeasoningTails(
  seasoningIds: readonly string[],
  depth: number,
  allowRepeats: boolean,
  limit: number,
): string[][] {
  const result: string[][] = []

  function visit(prefix: string[]) {
    if (result.length >= limit) return

    if (prefix.length === depth) {
      if (
        !allowRepeats ||
        new Set(prefix).size < prefix.length
      ) {
        result.push([...prefix])
      }
      return
    }

    for (const seasoningId of seasoningIds) {
      if (result.length >= limit) return
      if (!allowRepeats && prefix.includes(seasoningId)) {
        continue
      }
      prefix.push(seasoningId)
      visit(prefix)
      prefix.pop()
    }
  }

  visit([])
  return result
}

function sequenceLayer(
  currentProgress: ProgressMilestoneId,
  phase: RecipeCandidateSearchPhase,
  seasoningDepth: number,
  candidateLimit = RECIPE_SEARCH_LAYER_CANDIDATE_LIMIT,
): RecipeCandidateGenerationLayer {
  const { bases, seasonings } =
    availableSingleSegmentCapabilities(currentProgress)
  const seasoningIds = seasonings
    .map((capability) => capability.ingredientId)
    .sort(compareIds)
  const allowRepeats = phase === 'repeat-fallback'
  const tailCount = seasoningTailCount(
    seasoningIds.length,
    seasoningDepth,
    allowRepeats,
  )
  const totalSequenceCount = bases.length * tailCount
  const selectedSequences: string[][] = []

  for (const base of bases) {
    const remaining = candidateLimit - selectedSequences.length
    if (remaining <= 0) break

    const tails = collectSeasoningTails(
      seasoningIds,
      seasoningDepth,
      allowRepeats,
      remaining,
    )
    selectedSequences.push(
      ...tails.map((tail) => [base.ingredientId, ...tail]),
    )
  }

  return {
    phase,
    seasoningDepth,
    segmentCount: 1,
    ingredientCount: seasoningDepth + 1,
    candidates: selectedSequences.map((sequence) =>
      evaluatedCandidate(sequence, currentProgress),
    ),
    totalSequenceCount,
    truncated: selectedSequences.length < totalSequenceCount,
  }
}

function collectSeasoningDepthDistributions(
  segmentCount: number,
  totalSeasoningDepth: number,
): number[][] {
  const result: number[][] = []
  const maxSegmentSeasoningDepth = MAX_UNIQUE_INGREDIENT_COUNT - 1

  function visit(prefix: number[], remainingDepth: number) {
    if (prefix.length === segmentCount) {
      if (remainingDepth === 0) result.push([...prefix])
      return
    }

    const remainingSegments = segmentCount - prefix.length - 1
    const maximumDepth = Math.min(
      maxSegmentSeasoningDepth,
      remainingDepth,
    )

    for (let depth = 0; depth <= maximumDepth; depth += 1) {
      const nextRemaining = remainingDepth - depth
      if (
        nextRemaining >
        remainingSegments * maxSegmentSeasoningDepth
      ) {
        continue
      }

      prefix.push(depth)
      visit(prefix, nextRemaining)
      prefix.pop()
    }
  }

  visit([], totalSeasoningDepth)
  return result
}

function singleSegmentSequencesByDepth(
  currentProgress: ProgressMilestoneId,
  seasoningDepth: number,
): string[][] {
  const { bases, seasonings } =
    availableSingleSegmentCapabilities(currentProgress)
  const seasoningIds = seasonings
    .map((capability) => capability.ingredientId)
    .sort(compareIds)
  const tails = collectSeasoningTails(
    seasoningIds,
    seasoningDepth,
    false,
    permutationCount(seasoningIds.length, seasoningDepth),
  )

  return bases.flatMap((base) =>
    tails.map((tail) => [base.ingredientId, ...tail]),
  )
}

function blendedSequenceCount(
  currentProgress: ProgressMilestoneId,
  segmentCount: number,
  totalSeasoningDepth: number,
): number {
  const { bases, seasonings } =
    availableSingleSegmentCapabilities(currentProgress)
  const distributions = collectSeasoningDepthDistributions(
    segmentCount,
    totalSeasoningDepth,
  )

  return distributions.reduce((sum, distribution) => {
    const count = distribution.reduce(
      (product, depth) =>
        product *
        bases.length *
        permutationCount(seasonings.length, depth),
      1,
    )
    return sum + count
  }, 0)
}

function collectBlendedSequences(
  currentProgress: ProgressMilestoneId,
  segmentCount: number,
  totalSeasoningDepth: number,
  limit: number,
): string[][] {
  const result: string[][] = []
  const distributions = collectSeasoningDepthDistributions(
    segmentCount,
    totalSeasoningDepth,
  )
  const optionsByDepth = new Map<number, string[][]>()

  function segmentOptions(depth: number): string[][] {
    const existing = optionsByDepth.get(depth)
    if (existing) return existing

    const options = singleSegmentSequencesByDepth(
      currentProgress,
      depth,
    )
    optionsByDepth.set(depth, options)
    return options
  }

  for (const distribution of distributions) {
    if (result.length >= limit) break
    const selectedSegments: string[][] = []

    function visitSegment(segmentIndex: number) {
      if (result.length >= limit) return

      if (segmentIndex === segmentCount) {
        result.push(selectedSegments.flat())
        return
      }

      const options = segmentOptions(distribution[segmentIndex] ?? 0)
      for (const option of options) {
        if (result.length >= limit) return
        selectedSegments.push(option)
        visitSegment(segmentIndex + 1)
        selectedSegments.pop()
      }
    }

    visitSegment(0)
  }

  return result
}

function blendLayer(
  currentProgress: ProgressMilestoneId,
  segmentCount: 2 | 3,
  totalSeasoningDepth: number,
  candidateLimit: number,
): RecipeCandidateGenerationLayer {
  const totalSequenceCount = blendedSequenceCount(
    currentProgress,
    segmentCount,
    totalSeasoningDepth,
  )
  const selectedSequences = collectBlendedSequences(
    currentProgress,
    segmentCount,
    totalSeasoningDepth,
    candidateLimit,
  )

  return {
    phase: 'blend',
    seasoningDepth: totalSeasoningDepth,
    segmentCount,
    ingredientCount: segmentCount + totalSeasoningDepth,
    candidates: selectedSequences.map((sequence) =>
      evaluatedCandidate(sequence, currentProgress),
    ),
    totalSequenceCount,
    truncated: selectedSequences.length < totalSequenceCount,
  }
}

export { effectSlotCount, predictRecipeEffects }

export function generateUniqueRecipeCandidateLayers(
  currentProgress: ProgressMilestoneId,
): RecipeCandidateGenerationLayer[] {
  const maxSeasoningDepth = MAX_UNIQUE_INGREDIENT_COUNT - 1
  let remaining = RECIPE_SEARCH_TOTAL_CANDIDATE_LIMIT

  return Array.from(
    { length: maxSeasoningDepth + 1 },
    (_, seasoningDepth) => {
      const layer = sequenceLayer(
        currentProgress,
        'unique',
        seasoningDepth,
        Math.min(
          RECIPE_SEARCH_LAYER_CANDIDATE_LIMIT,
          remaining,
        ),
      )
      remaining = Math.max(
        0,
        remaining - layer.candidates.length,
      )

      return layer
    },
  )
}

export function generateBlendedRecipeCandidateLayers(
  currentProgress: ProgressMilestoneId,
): RecipeCandidateGenerationLayer[] {
  const specs: {
    segmentCount: 2 | 3
    seasoningDepth: number
  }[] = []

  const maximumIngredientCount =
    2 +
    MAX_BLEND_TOTAL_SEASONING_DEPTH_BY_SEGMENT_COUNT[2]

  for (
    let ingredientCount = 2;
    ingredientCount <= maximumIngredientCount;
    ingredientCount += 1
  ) {
    for (
      let segmentCount = 2 as 2 | 3;
      segmentCount <= MAX_BLEND_SEGMENT_COUNT;
      segmentCount += 1
    ) {
      const typedSegmentCount = segmentCount as 2 | 3
      const seasoningDepth = ingredientCount - typedSegmentCount
      const maximumSeasoningDepth =
        MAX_BLEND_TOTAL_SEASONING_DEPTH_BY_SEGMENT_COUNT[
          typedSegmentCount
        ]

      if (
        seasoningDepth < 0 ||
        seasoningDepth > maximumSeasoningDepth
      ) {
        continue
      }

      specs.push({
        segmentCount: typedSegmentCount,
        seasoningDepth,
      })
    }
  }

  let remaining = BLEND_SEARCH_TOTAL_CANDIDATE_LIMIT
  return specs.map(({ segmentCount, seasoningDepth }) => {
    const layer = blendLayer(
      currentProgress,
      segmentCount,
      seasoningDepth,
      Math.min(
        BLEND_SEARCH_LAYER_CANDIDATE_LIMIT,
        remaining,
      ),
    )
    remaining = Math.max(
      0,
      remaining - layer.candidates.length,
    )
    return layer
  })
}

export function generateProgressiveRecipeCandidateLayers(
  currentProgress: ProgressMilestoneId,
): RecipeCandidateGenerationLayer[] {
  return [
    ...generateUniqueRecipeCandidateLayers(currentProgress),
    ...generateBlendedRecipeCandidateLayers(currentProgress),
  ].sort(
    (left, right) =>
      left.ingredientCount - right.ingredientCount ||
      left.segmentCount - right.segmentCount ||
      left.seasoningDepth - right.seasoningDepth,
  )
}

export function generateRepeatedSeasoningCandidateLayer(
  currentProgress: ProgressMilestoneId,
  seasoningDepth: number,
): RecipeCandidateGenerationLayer {
  const minimumDepth = 2
  const maximumDepth = MAX_REPEATED_RECIPE_INGREDIENT_COUNT - 1

  if (
    seasoningDepth < minimumDepth ||
    seasoningDepth > maximumDepth
  ) {
    throw new Error(
      `Repeated seasoning depth must be between ${minimumDepth} and ${maximumDepth}`,
    )
  }

  return sequenceLayer(
    currentProgress,
    'repeat-fallback',
    seasoningDepth,
  )
}

export function generateRecipeCandidates(
  currentProgress: ProgressMilestoneId,
): RecipeCandidate[] {
  return generateUniqueRecipeCandidateLayers(currentProgress)
    .flatMap((layer) => layer.candidates)
}
