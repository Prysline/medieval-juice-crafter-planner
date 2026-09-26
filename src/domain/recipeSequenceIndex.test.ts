import { describe, expect, it } from 'vitest'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildContiguousRecipeSequenceIndex,
  recipeEntriesForContiguousSequence,
} from './recipeSequenceIndex'

function sequences(entries: readonly { ingredientIds: readonly string[] }[]) {
  return entries.map((entry) => entry.ingredientIds.join('>'))
}

describe('contiguous recipe sequence index', () => {
  const pool = buildRecipeCandidatePool('juice-blender-unlocked')
  const entries = pool.entries.filter(
    (entry) => entry.availableAtCurrentProgress,
  )
  const index = buildContiguousRecipeSequenceIndex(entries)

  it('matches exact contiguous ingredient order anywhere in a recipe', () => {
    const matches = recipeEntriesForContiguousSequence(
      entries,
      index,
      ['lemon', 'mint'],
    )

    expect(
      matches.every((entry) => {
        const sequence = entry.ingredientIds
        return sequence.some(
          (ingredientId, position) =>
            ingredientId === 'lemon' &&
            sequence[position + 1] === 'mint',
        )
      }),
    ).toBe(true)
  })

  it('does not match the same ingredients when another ingredient interrupts the sequence', () => {
    const matches = recipeEntriesForContiguousSequence(
      entries,
      index,
      ['lemon', 'mint'],
    )
    const matchingSequences = new Set(sequences(matches))

    expect(matchingSequences.has('lemon>sugar>mint')).toBe(false)
  })

  it('keeps ingredient order significant', () => {
    const forward = new Set(
      sequences(
        recipeEntriesForContiguousSequence(
          entries,
          index,
          ['lemon', 'mint'],
        ),
      ),
    )
    const reverse = new Set(
      sequences(
        recipeEntriesForContiguousSequence(
          entries,
          index,
          ['mint', 'lemon'],
        ),
      ),
    )

    expect(forward).not.toEqual(reverse)
  })

  it('supports repeated contiguous ingredients and returns all entries for an empty sequence', () => {
    const repeated = recipeEntriesForContiguousSequence(
      entries,
      index,
      ['mint', 'mint'],
    )

    expect(
      repeated.every((entry) =>
        entry.ingredientIds.some(
          (ingredientId, position) =>
            ingredientId === 'mint' &&
            entry.ingredientIds[position + 1] === 'mint',
        ),
      ),
    ).toBe(true)
    expect(
      recipeEntriesForContiguousSequence(entries, index, []),
    ).toBe(entries)
  })
})
