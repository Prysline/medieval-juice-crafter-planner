import { describe, expect, it } from 'vitest'
import {
  buildIntermediateJuiceSearchIndex,
  buildInventoryRecipeSearchIndex,
  intermediateJuiceInventoryEntries,
  searchIntermediateJuiceIndex,
  searchInventoryRecipeIndex,
} from './OptimizerTools'
import {
  buildRecipeCandidatePool,
  recipeCandidateEntriesForInventoryEditor,
} from './domain/recipeCandidatePool'

const PROFILE_PROGRESS = 'juice-blender-unlocked' as const
const SEARCH_MEDIAN_BUDGET_MS = 80

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
  it('keeps full-authority inventory and intermediate search below the regression budget', () => {
    const pool = buildRecipeCandidatePool(PROFILE_PROGRESS)
    const inventoryEntries =
      recipeCandidateEntriesForInventoryEditor(pool)
    const intermediateEntries = intermediateJuiceInventoryEntries(
      inventoryEntries,
      PROFILE_PROGRESS,
    )

    expect(inventoryEntries.length).toBeGreaterThan(9000)
    expect(intermediateEntries.length).toBeGreaterThan(9000)

    const inventoryIndex =
      buildInventoryRecipeSearchIndex(inventoryEntries)
    const intermediateIndex =
      buildIntermediateJuiceSearchIndex(intermediateEntries)

    const inventoryBroadMs = medianMs(() =>
      searchInventoryRecipeIndex(inventoryIndex, '檸'),
    )
    const intermediateBroadMs = medianMs(() =>
      searchIntermediateJuiceIndex(intermediateIndex, '檸'),
    )

    console.log('[search-responsiveness-regression]', {
      inventoryEntries: inventoryEntries.length,
      intermediateEntries: intermediateEntries.length,
      inventoryBroadMs,
      intermediateBroadMs,
    })

    expect(inventoryBroadMs).toBeLessThan(
      SEARCH_MEDIAN_BUDGET_MS,
    )
    expect(intermediateBroadMs).toBeLessThan(
      SEARCH_MEDIAN_BUDGET_MS,
    )
  }, 20_000)
})
