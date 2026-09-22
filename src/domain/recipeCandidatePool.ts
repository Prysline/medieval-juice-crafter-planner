import { ingredients } from '../data/ingredients'
import type {
  ProgressMilestoneId,
  RecipeCandidate,
  RecipeSequenceIssue,
  SavedRecipe,
} from '../types'
import { isAvailableAtProgress } from './availability'
import { evaluateRecipeSequence } from './recipeEvaluator'
import {
  generateProgressiveRecipeCandidateLayers,
  type RecipeCandidateSearchPhase,
} from './recipeGenerator'

export type RecipeCandidatePoolSource =
  | 'observed'
  | 'saved'
  | 'computed'
  | 'ambiguous-computed'

export interface RecipeCandidatePoolEntry {
  readonly id: string
  readonly ingredientIds: readonly string[]
  readonly candidate: RecipeCandidate
  readonly sources: readonly RecipeCandidatePoolSource[]
  readonly savedRecipeIds: readonly string[]
  readonly availableAtCurrentProgress: boolean
  readonly inGeneratedSearchScope: boolean
}

export interface RecipeCandidatePoolLayer {
  readonly phase: RecipeCandidateSearchPhase
  readonly seasoningDepth: number
  readonly segmentCount: number
  readonly ingredientCount: number
  readonly candidateIds: readonly string[]
  readonly totalSequenceCount: number
  readonly truncated: boolean
}

export interface RejectedSavedRecipeCandidate {
  readonly savedRecipeId: string
  readonly issues: readonly RecipeSequenceIssue[]
}

export interface RecipeCandidatePool {
  readonly entries: readonly RecipeCandidatePoolEntry[]
  readonly generatedLayers: readonly RecipeCandidatePoolLayer[]
  readonly rejectedSavedRecipes: readonly RejectedSavedRecipeCandidate[]
}

const ingredientIdByName = new Map(
  ingredients.map((ingredient) => [ingredient.name, ingredient.id]),
)

const sourceOrder: readonly RecipeCandidatePoolSource[] = [
  'observed',
  'saved',
  'computed',
  'ambiguous-computed',
]

function sequenceKey(ingredientIds: readonly string[]): string {
  return ingredientIds.join('\u001f')
}

function ingredientIdsForCandidate(
  candidate: RecipeCandidate,
): string[] {
  return candidate.ingredients.map((name) => {
    const id = ingredientIdByName.get(name)
    if (!id) {
      throw new Error(
        `Missing ingredient id for generated candidate ingredient: ${name}`,
      )
    }
    return id
  })
}

function derivedSource(
  candidate: RecipeCandidate,
): RecipeCandidatePoolSource {
  if (candidate.source === 'observed') return 'observed'
  return candidate.effectAmbiguity
    ? 'ambiguous-computed'
    : 'computed'
}

function mergeSources(
  left: readonly RecipeCandidatePoolSource[],
  right: readonly RecipeCandidatePoolSource[],
): RecipeCandidatePoolSource[] {
  const values = new Set([...left, ...right])
  return sourceOrder.filter((source) => values.has(source))
}

export function buildRecipeCandidatePool(
  currentProgress: ProgressMilestoneId,
  savedRecipes: readonly SavedRecipe[] = [],
): RecipeCandidatePool {
  const entriesBySequence = new Map<string, RecipeCandidatePoolEntry>()
  const order: string[] = []
  const rejectedSavedRecipes: RejectedSavedRecipeCandidate[] = []

  const mergeEntry = ({
    ingredientIds,
    candidate,
    sources,
    savedRecipeIds = [],
    availableAtCurrentProgress,
    inGeneratedSearchScope,
  }: {
    ingredientIds: string[]
    candidate: RecipeCandidate
    sources: RecipeCandidatePoolSource[]
    savedRecipeIds?: string[]
    availableAtCurrentProgress: boolean
    inGeneratedSearchScope: boolean
  }) => {
    const key = sequenceKey(ingredientIds)
    const current = entriesBySequence.get(key)

    if (!current) {
      order.push(key)
      entriesBySequence.set(key, {
        id: candidate.id,
        ingredientIds: [...ingredientIds],
        candidate,
        sources: mergeSources([], sources),
        savedRecipeIds: [...new Set(savedRecipeIds)],
        availableAtCurrentProgress,
        inGeneratedSearchScope,
      })
      return
    }

    if (current.candidate.id !== candidate.id) {
      throw new Error(
        `Candidate identity drift for sequence: ${ingredientIds.join(' -> ')}`,
      )
    }

    entriesBySequence.set(key, {
      ...current,
      sources: mergeSources(current.sources, sources),
      savedRecipeIds: [
        ...new Set([...current.savedRecipeIds, ...savedRecipeIds]),
      ],
      availableAtCurrentProgress:
        current.availableAtCurrentProgress || availableAtCurrentProgress,
      inGeneratedSearchScope:
        current.inGeneratedSearchScope || inGeneratedSearchScope,
    })
  }

  const generatedLayers = generateProgressiveRecipeCandidateLayers(
    currentProgress,
  ).map((layer): RecipeCandidatePoolLayer => {
    const candidateIds: string[] = []

    for (const candidate of layer.candidates) {
      const ingredientIds = ingredientIdsForCandidate(candidate)
      mergeEntry({
        ingredientIds,
        candidate,
        sources: [derivedSource(candidate)],
        availableAtCurrentProgress: isAvailableAtProgress(
          candidate.unlockedAt,
          currentProgress,
        ),
        inGeneratedSearchScope: true,
      })
      candidateIds.push(candidate.id)
    }

    return {
      phase: layer.phase,
      seasoningDepth: layer.seasoningDepth,
      segmentCount: layer.segmentCount,
      ingredientCount: layer.ingredientCount,
      candidateIds,
      totalSequenceCount: layer.totalSequenceCount,
      truncated: layer.truncated,
    }
  })

  for (const savedRecipe of savedRecipes) {
    const evaluation = evaluateRecipeSequence(
      savedRecipe.ingredientIds,
      currentProgress,
    )

    if (!evaluation.valid) {
      rejectedSavedRecipes.push({
        savedRecipeId: savedRecipe.id,
        issues: [...evaluation.issues],
      })
      continue
    }

    mergeEntry({
      ingredientIds: [...evaluation.ingredientIds],
      candidate: evaluation.candidate,
      sources: ['saved', derivedSource(evaluation.candidate)],
      savedRecipeIds: [savedRecipe.id],
      availableAtCurrentProgress:
        evaluation.availableAtCurrentProgress,
      inGeneratedSearchScope: false,
    })
  }

  return {
    entries: order.map((key) => entriesBySequence.get(key)!),
    generatedLayers,
    rejectedSavedRecipes,
  }
}

export function recipeCandidatesInCurrentSearchScope(
  pool: RecipeCandidatePool,
): RecipeCandidate[] {
  return pool.entries
    .filter(
      (entry) =>
        entry.inGeneratedSearchScope &&
        entry.availableAtCurrentProgress,
    )
    .map((entry) => entry.candidate)
}

export function recipeCandidateEntriesForInventoryEditor(
  pool: RecipeCandidatePool,
): RecipeCandidatePoolEntry[] {
  return pool.entries.filter(
    (entry) =>
      entry.availableAtCurrentProgress &&
      (
        entry.sources.includes('observed') ||
        entry.sources.includes('saved') ||
        entry.sources.includes('computed')
      ),
  )
}

export function recipeCandidatesForInventoryEditor(
  pool: RecipeCandidatePool,
): RecipeCandidate[] {
  return recipeCandidateEntriesForInventoryEditor(pool)
    .map((entry) => entry.candidate)
}
