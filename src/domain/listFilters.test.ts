import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import {
  buildRecipeCandidatePool,
  type RecipeCandidatePoolEntry,
} from './recipeCandidatePool'
import {
  customerMatchesResearchFilters,
  recipeEntryMatchesResearchFilters,
} from './listFilters'

function customer(id: string) {
  const value = customers.find((item) => item.id === id)
  if (!value) throw new Error(`Missing customer fixture: ${id}`)
  return value
}

function entryBySequence(
  entries: readonly RecipeCandidatePoolEntry[],
  ingredientIds: readonly string[],
) {
  const key = ingredientIds.join('>')
  const entry = entries.find(
    (item) => item.ingredientIds.join('>') === key,
  )
  if (!entry) throw new Error(`Missing recipe fixture: ${key}`)
  return entry
}

describe('customer research filters', () => {
  it('keeps village as a hard scope and applies all/any only to preference filters', () => {
    const filters = {
      villageId: 'east-harbor' as const,
      preferenceIngredient: '橙子',
      preferenceEffect: '增強免疫',
      preferenceMode: 'all' as const,
    }

    expect(
      customerMatchesResearchFilters(customer('galiana'), filters),
    ).toBe(true)
    expect(
      customerMatchesResearchFilters(customer('otilde'), filters),
    ).toBe(false)

    expect(
      customerMatchesResearchFilters(customer('galiana'), {
        ...filters,
        preferenceMode: 'any',
      }),
    ).toBe(true)
    expect(
      customerMatchesResearchFilters(customer('otilde'), {
        ...filters,
        preferenceMode: 'any',
      }),
    ).toBe(true)

    expect(
      customerMatchesResearchFilters(customer('sarah'), {
        ...filters,
        preferenceMode: 'any',
      }),
    ).toBe(false)
  })

  it('does not treat unknown preferences as matching a selected preference', () => {
    expect(
      customerMatchesResearchFilters(customer('daniel'), {
        villageId: 'tranquil-fountain',
        preferenceIngredient: null,
        preferenceEffect: '甜味',
        preferenceMode: 'any',
      }),
    ).toBe(false)
  })
})

describe('recipe research filters', () => {
  const pool = buildRecipeCandidatePool('juice-blender-unlocked')
  const entries = pool.entries.filter(
    (entry) => entry.availableAtCurrentProgress,
  )

  it('filters exact ingredient count and canonical ingredient identity', () => {
    const lemonPear = entryBySequence(entries, ['lemon', 'pear'])

    expect(
      recipeEntryMatchesResearchFilters(lemonPear, {
        ingredientCount: 2,
        ingredientId: 'pear',
        confirmedEffect: null,
        possibleEffect: null,
        source: 'all',
        price: 'all',
      }),
    ).toBe(true)
    expect(
      recipeEntryMatchesResearchFilters(lemonPear, {
        ingredientCount: 3,
        ingredientId: 'pear',
        confirmedEffect: null,
        possibleEffect: null,
        source: 'all',
        price: 'all',
      }),
    ).toBe(false)
  })

  it('keeps confirmed and ambiguity-only possible effects as separate filters', () => {
    const ambiguous = entries.find(
      (entry) =>
        entry.candidate.effectAmbiguity &&
        entry.candidate.effectAmbiguity.candidates.length > 0,
    )
    expect(ambiguous).toBeDefined()
    if (!ambiguous?.candidate.effectAmbiguity) return

    const possible =
      ambiguous.candidate.effectAmbiguity.candidates[0].name

    expect(
      recipeEntryMatchesResearchFilters(ambiguous, {
        ingredientCount: null,
        ingredientId: null,
        confirmedEffect: possible,
        possibleEffect: null,
        source: 'all',
        price: 'all',
      }),
    ).toBe(
      ambiguous.candidate.effects.some(
        (effect) => effect.name === possible,
      ),
    )
    expect(
      recipeEntryMatchesResearchFilters(ambiguous, {
        ingredientCount: null,
        ingredientId: null,
        confirmedEffect: null,
        possibleEffect: possible,
        source: 'all',
        price: 'all',
      }),
    ).toBe(true)
  })

  it('can filter a saved provenance independently from computed/observed source', () => {
    const savedPool = buildRecipeCandidatePool(
      'juice-blender-unlocked',
      [
        {
          id: 'saved-lemon',
          name: '我的檸檬',
          ingredientIds: ['lemon'],
          createdAt: '2026-09-22T00:00:00.000Z',
        },
      ],
    )
    const savedObserved = entryBySequence(
      savedPool.entries,
      ['lemon'],
    )

    expect(savedObserved.sources).toContain('observed')
    expect(savedObserved.sources).toContain('saved')
    expect(
      recipeEntryMatchesResearchFilters(savedObserved, {
        ingredientCount: null,
        ingredientId: null,
        confirmedEffect: null,
        possibleEffect: null,
        source: 'saved',
        price: 'all',
      }),
    ).toBe(true)
  })

  it('filters by merged provenance and known-price state', () => {
    const observed = entryBySequence(entries, ['lemon'])
    const computed = entries.find(
      (entry) =>
        entry.sources.includes('computed') &&
        entry.candidate.salePrice === null,
    )
    expect(computed).toBeDefined()

    expect(
      recipeEntryMatchesResearchFilters(observed, {
        ingredientCount: null,
        ingredientId: null,
        confirmedEffect: null,
        possibleEffect: null,
        source: 'observed',
        price: 'known',
      }),
    ).toBe(true)

    expect(
      recipeEntryMatchesResearchFilters(computed!, {
        ingredientCount: null,
        ingredientId: null,
        confirmedEffect: null,
        possibleEffect: null,
        source: 'computed',
        price: 'unknown',
      }),
    ).toBe(true)
  })
})
