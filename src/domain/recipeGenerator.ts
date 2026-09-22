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

export type RecipeCandidateSearchPhase = 'unique' | 'repeat-fallback'

export interface RecipeCandidateGenerationLayer {
  readonly phase: RecipeCandidateSearchPhase
  readonly seasoningDepth: number
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
