import { describe, expect, it } from 'vitest'
import { ingredients } from './data/ingredients'
import { formatRecipeDisplayName } from './domain/displayFormat'
import {
  buildRecipeCandidatePool,
  recipeCandidateEntriesForInventoryEditor,
} from './domain/recipeCandidatePool'
import { intermediateJuiceInventoryEntries } from './OptimizerTools'

const PROFILE_PROGRESS = 'juice-blender-unlocked' as const

describe('search normalization equivalence audit', () => {
  it('keeps current searchable corpus identical under locale-free lowercase', () => {
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
      searchableStrings.add(formatRecipeDisplayName(entry.candidate.name))
      searchableStrings.add(entry.candidate.ingredients.join(' '))
      searchableStrings.add(entry.ingredientIds.join(' '))
      searchableStrings.add(entry.candidate.id)
    }
    for (const entry of intermediateEntries) {
      searchableStrings.add(entry.label)
      searchableStrings.add(entry.ingredientIds.join(' '))
      for (const ingredientId of entry.ingredientIds) {
        searchableStrings.add(
          ingredientNameById.get(ingredientId) ?? ingredientId,
        )
        searchableStrings.add(ingredientId)
      }
    }

    const mismatches = [...searchableStrings].filter(
      (value) =>
        value.trim().toLowerCase() !==
        value.trim().toLocaleLowerCase('zh-Hant'),
    )

    console.log('[search-normalization-equivalence]', {
      searchableStrings: searchableStrings.size,
      mismatches: mismatches.length,
    })

    expect(searchableStrings.size).toBeGreaterThan(10_000)
    expect(mismatches).toEqual([])
  }, 20_000)
})
