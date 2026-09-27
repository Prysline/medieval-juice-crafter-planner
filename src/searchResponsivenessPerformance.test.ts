import { describe, expect, it } from 'vitest'
import { ingredients } from './data/ingredients'
import {
  buildIntermediateJuiceSearchIndex,
  buildInventoryRecipeSearchIndex,
  intermediateJuiceInventoryEntries,
  searchIntermediateJuiceIndex,
  searchInventoryRecipeIndex,
} from './OptimizerTools'
import { formatRecipeDisplayName } from './domain/displayFormat'
import {
  buildRecipeCandidatePool,
  recipeCandidateEntriesForInventoryEditor,
} from './domain/recipeCandidatePool'

const PROFILE_PROGRESS = 'juice-blender-unlocked' as const
const SEARCH_MEDIAN_BUDGET_MS = 80
const INDEX_BUILD_TOTAL_BUDGET_MS = 300

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function medianMs(run: () => unknown, iterations = 3): number {
  run()
  const samples: number[] = []
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now()
    run()
    samples.push(performance.now() - startedAt)
  }
  return median(samples)
}

describe('production-scale searchable combobox responsiveness', () => {
  it('keeps lowercase normalization equivalent across the full current search authority', () => {
    const pool = buildRecipeCandidatePool(PROFILE_PROGRESS)
    const inventoryEntries =
      recipeCandidateEntriesForInventoryEditor(pool)
    const intermediateEntries = intermediateJuiceInventoryEntries(
      inventoryEntries,
      PROFILE_PROGRESS,
    )
    const ingredientNameById = new Map(
      ingredients.map((ingredient) => [ingredient.id, ingredient.name]),
    )
    const searchableStrings = new Set<string>()

    for (const entry of inventoryEntries) {
      searchableStrings.add(
        formatRecipeDisplayName(entry.candidate.name),
      )
      searchableStrings.add(entry.candidate.ingredients.join(' '))
      searchableStrings.add(entry.ingredientIds.join(' '))
      searchableStrings.add(entry.candidate.id)
    }

    for (const entry of intermediateEntries) {
      const ingredientNames = entry.ingredientIds.map(
        (ingredientId) =>
          ingredientNameById.get(ingredientId) ?? ingredientId,
      )
      searchableStrings.add(entry.label)
      searchableStrings.add(entry.ingredientIds.join(' '))
      searchableStrings.add(ingredientNames.join(' '))
      if (entry.ingredientIds.length === 1) {
        searchableStrings.add(entry.ingredientIds[0] ?? '')
        searchableStrings.add(ingredientNames[0] ?? '')
      }
    }

    const mismatches = [...searchableStrings].filter(
      (value) =>
        value.trim().toLowerCase() !==
        value.trim().toLocaleLowerCase('zh-Hant'),
    )

    console.log('[search-normalization-equivalence]', {
      distinctStrings: searchableStrings.size,
      mismatches: mismatches.length,
    })

    expect(searchableStrings.size).toBeGreaterThan(40_000)
    expect(mismatches).toEqual([])
  }, 20_000)

  it('keeps full-authority index build and query work below the regression budgets', () => {
    const pool = buildRecipeCandidatePool(PROFILE_PROGRESS)
    const inventoryEntries =
      recipeCandidateEntriesForInventoryEditor(pool)
    const intermediateEntries = intermediateJuiceInventoryEntries(
      inventoryEntries,
      PROFILE_PROGRESS,
    )

    expect(inventoryEntries.length).toBeGreaterThan(9000)
    expect(intermediateEntries.length).toBeGreaterThan(9000)

    const inventoryIndexStartedAt = performance.now()
    const inventoryIndex =
      buildInventoryRecipeSearchIndex(inventoryEntries)
    const inventoryIndexBuildMs =
      performance.now() - inventoryIndexStartedAt

    const intermediateIndexStartedAt = performance.now()
    const intermediateIndex =
      buildIntermediateJuiceSearchIndex(intermediateEntries)
    const intermediateIndexBuildMs =
      performance.now() - intermediateIndexStartedAt

    const inventoryBroadMs = medianMs(() =>
      searchInventoryRecipeIndex(inventoryIndex, '檸'),
    )
    const intermediateBroadMs = medianMs(() =>
      searchIntermediateJuiceIndex(intermediateIndex, '檸'),
    )
    const totalIndexBuildMs =
      inventoryIndexBuildMs + intermediateIndexBuildMs

    console.log('[search-responsiveness-regression]', {
      inventoryEntries: inventoryEntries.length,
      intermediateEntries: intermediateEntries.length,
      inventoryIndexBuildMs,
      intermediateIndexBuildMs,
      totalIndexBuildMs,
      inventoryBroadMs,
      intermediateBroadMs,
    })

    expect(totalIndexBuildMs).toBeLessThan(
      INDEX_BUILD_TOTAL_BUDGET_MS,
    )
    expect(inventoryBroadMs).toBeLessThan(
      SEARCH_MEDIAN_BUDGET_MS,
    )
    expect(intermediateBroadMs).toBeLessThan(
      SEARCH_MEDIAN_BUDGET_MS,
    )
  }, 20_000)
})
