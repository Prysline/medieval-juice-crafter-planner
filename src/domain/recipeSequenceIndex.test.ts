import { describe, expect, it } from 'vitest'
import type { RecipeCandidatePoolEntry } from './recipeCandidatePool'
import {
  buildContiguousRecipeSequenceIndex,
  recipeEntriesForContiguousSequence,
} from './recipeSequenceIndex'

function entry(
  id: string,
  ingredientIds: readonly string[],
): RecipeCandidatePoolEntry {
  return {
    id,
    ingredientIds,
    candidate: {
      id,
      name: id,
      source: 'computed',
      unlockedAt: 'opening',
      salePrice: null,
      ingredients: [...ingredientIds],
      effects: [],
      equipment: [],
    },
    sources: ['computed'],
    savedRecipeIds: [],
    availableAtCurrentProgress: true,
    inGeneratedSearchScope: true,
  }
}

describe('contiguous recipe sequence index', () => {
  const entries = [
    entry('exact', ['lemon', 'mint']),
    entry('interrupted', ['lemon', 'sugar', 'mint']),
    entry('embedded', ['sugar', 'lemon', 'mint', 'pear']),
    entry('reverse', ['mint', 'lemon']),
    entry('repeated', ['lemon', 'mint', 'mint', 'sugar']),
  ]
  const index = buildContiguousRecipeSequenceIndex(entries)

  it('matches an exact contiguous ingredient fragment anywhere in a recipe', () => {
    expect(
      recipeEntriesForContiguousSequence(
        entries,
        index,
        ['lemon', 'mint'],
      ).map((item) => item.id),
    ).toEqual(['exact', 'embedded', 'repeated'])
  })

  it('does not match when another ingredient interrupts the selected order', () => {
    expect(
      recipeEntriesForContiguousSequence(
        entries,
        index,
        ['lemon', 'mint'],
      ).map((item) => item.id),
    ).not.toContain('interrupted')
  })

  it('keeps ingredient order significant', () => {
    expect(
      recipeEntriesForContiguousSequence(
        entries,
        index,
        ['mint', 'lemon'],
      ).map((item) => item.id),
    ).toEqual(['reverse'])
  })

  it('supports repeated contiguous ingredients and an empty filter', () => {
    expect(
      recipeEntriesForContiguousSequence(
        entries,
        index,
        ['mint', 'mint'],
      ).map((item) => item.id),
    ).toEqual(['repeated'])
    expect(
      recipeEntriesForContiguousSequence(entries, index, []),
    ).toBe(entries)
  })
})
