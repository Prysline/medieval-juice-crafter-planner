import { describe, expect, it } from 'vitest'
import type { Customer, RecipeCandidate } from '../types'
import type { RecipeCandidatePool } from './recipeCandidatePool'
import { searchRecipeCandidatesForCustomer } from './recipeSearch'

function candidate(
  id: string,
  ingredients: string[],
): RecipeCandidate {
  return {
    id,
    name: id,
    source: 'computed',
    unlockedAt: 'opening',
    salePrice: null,
    ingredients,
    effects: [{ name: '甜味', value: 5 }],
    equipment: [],
  }
}

function customer(): Customer {
  return {
    id: 'search-result-fixture',
    name: '測試顧客',
    occupation: '測試',
    villageId: 'east-harbor',
    satisfactionRequired: 0,
    preferences: [{ kind: 'effect', value: '甜味' }],
  }
}

function pool(
  candidates: RecipeCandidate[],
): RecipeCandidatePool {
  return {
    entries: candidates.map((item) => ({
      id: item.id,
      ingredientIds: item.ingredients,
      candidate: item,
      sources: ['computed'],
      savedRecipeIds: [],
      availableAtCurrentProgress: true,
      inGeneratedSearchScope: true,
    })),
    generatedLayers: candidates.map((item, index) => ({
      phase: 'unique',
      seasoningDepth: index,
      segmentCount: 1,
      ingredientCount: item.ingredients.length,
      candidateIds: [item.id],
      totalSequenceCount: 1,
      truncated: false,
    })),
    rejectedSavedRecipes: [],
  }
}

describe('progressive search reusable match result', () => {
  it('returns the final eligible full matches after unique-ingredient preference', () => {
    const repeated = candidate(
      'repeated-full-match',
      ['橙子', '糖', '糖'],
    )
    const unique = candidate(
      'unique-full-match',
      ['檸檬', '糖'],
    )

    const result = searchRecipeCandidatesForCustomer(
      pool([repeated, unique]),
      'seasoner-unlocked',
      customer(),
      {
        candidatePolicy: 'allow-unambiguous-computed',
        mode: 'bounded-exhaustive',
      },
    )

    expect(result.candidates.map((item) => item.id)).toEqual([
      'unique-full-match',
    ])
    expect(
      result.eligibleFullMatchCandidates.map((item) => item.id),
    ).toEqual(['unique-full-match'])
  })

  it('applies additional eligibility before exposing reusable matches', () => {
    const excluded = candidate('excluded-full-match', ['橙子'])
    const included = candidate('included-full-match', ['檸檬'])

    const result = searchRecipeCandidatesForCustomer(
      pool([excluded, included]),
      'seasoner-unlocked',
      customer(),
      {
        candidatePolicy: 'allow-unambiguous-computed',
        mode: 'bounded-exhaustive',
        additionalCandidateEligibility: (item) =>
          item.id !== excluded.id,
      },
    )

    expect(
      result.eligibleFullMatchCandidates.map((item) => item.id),
    ).toEqual(['included-full-match'])
  })

  it('does not expose an eligible candidate that is not a full match', () => {
    const nonMatch = {
      ...candidate('non-match', ['梨']),
      effects: [{ name: '酸味', value: 5 }],
    }
    const match = candidate('full-match', ['檸檬'])

    const result = searchRecipeCandidatesForCustomer(
      pool([nonMatch, match]),
      'seasoner-unlocked',
      customer(),
      {
        candidatePolicy: 'allow-unambiguous-computed',
        mode: 'bounded-exhaustive',
      },
    )

    expect(
      result.eligibleFullMatchCandidates.map((item) => item.id),
    ).toEqual(['full-match'])
  })
})
