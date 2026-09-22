import { describe, expect, it } from 'vitest'
import type { Customer, SavedRecipe } from '../types'
import { matchingRecipeCandidatesForCustomer } from './matching'
import {
  buildOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import {
  buildRecipeCandidatePool,
  recipeCandidatesInCurrentSearchScope,
} from './recipeCandidatePool'
import { searchRecipeCandidatesForCustomer } from './recipeSearch'

function saved(
  id: string,
  ingredientIds: string[],
): SavedRecipe {
  return {
    id,
    name: id,
    ingredientIds,
    createdAt: '2026-09-22T00:00:00.000Z',
  }
}

describe('shared recipe candidate pool', () => {
  it('merges observed and saved provenance for the same sequence without duplicating the candidate', () => {
    const pool = buildRecipeCandidatePool(
      'seasoner-unlocked',
      [saved('saved-lemon-mint', ['lemon', 'mint'])],
    )

    const matching = pool.entries.filter(
      (entry) =>
        entry.ingredientIds.join('>') === 'lemon>mint',
    )

    expect(matching).toHaveLength(1)
    expect(matching[0]).toMatchObject({
      id: 'lemon-mint',
      sources: ['observed', 'saved'],
      savedRecipeIds: ['saved-lemon-mint'],
      inGeneratedSearchScope: true,
      availableAtCurrentProgress: true,
    })
  })

  it('merges multiple saved rows for one sequence while preserving one stable candidate identity', () => {
    const pool = buildRecipeCandidatePool(
      'seasoner-unlocked',
      [
        saved('saved-a', ['lemon', 'mint']),
        saved('saved-b', ['lemon', 'mint']),
      ],
    )

    const matching = pool.entries.filter(
      (entry) =>
        entry.ingredientIds.join('>') === 'lemon>mint',
    )

    expect(matching).toHaveLength(1)
    expect(matching[0].id).toBe('lemon-mint')
    expect(matching[0].savedRecipeIds).toEqual([
      'saved-a',
      'saved-b',
    ])
  })

  it('keeps saved-only sequences in pool metadata without expanding the current generated search scope', () => {
    const pool = buildRecipeCandidatePool(
      'seasoner-unlocked',
      [saved('saved-repeat', ['lemon', 'mint', 'mint'])],
    )

    const savedOnly = pool.entries.find(
      (entry) => entry.savedRecipeIds.includes('saved-repeat'),
    )
    expect(savedOnly).toBeDefined()
    expect(savedOnly?.sources).toContain('saved')
    expect(savedOnly?.inGeneratedSearchScope).toBe(false)

    expect(
      recipeCandidatesInCurrentSearchScope(pool).some(
        (candidate) => candidate.id === savedOnly?.candidate.id,
      ),
    ).toBe(false)
  })

  it('keeps future-progress saved recipes as metadata but out of the current search scope', () => {
    const pool = buildRecipeCandidatePool(
      'seasoner-unlocked',
      [saved('saved-future', ['banana'])],
    )

    const entry = pool.entries.find(
      (candidate) =>
        candidate.savedRecipeIds.includes('saved-future'),
    )

    expect(entry).toBeDefined()
    expect(entry?.sources).toContain('saved')
    expect(entry?.availableAtCurrentProgress).toBe(false)
    expect(entry?.inGeneratedSearchScope).toBe(false)
    expect(
      recipeCandidatesInCurrentSearchScope(pool).some(
        (candidate) => candidate.id === entry?.candidate.id,
      ),
    ).toBe(false)
  })

  it('keeps ambiguous computed provenance explicit instead of treating it as safe computed', () => {
    const pool = buildRecipeCandidatePool(
      'tranquil-fountain-unlocked',
      [saved('saved-ambiguous', ['lemon', 'cinnamon', 'mint'])],
    )

    const entry = pool.entries.find(
      (candidate) =>
        candidate.savedRecipeIds.includes('saved-ambiguous'),
    )

    expect(entry?.sources).toContain('saved')
    expect(entry?.sources).toContain('ambiguous-computed')
    expect(entry?.sources).not.toContain('computed')
    expect(entry?.candidate.effectAmbiguity).toBeDefined()
  })

  it('evaluates saved recipes through the canonical evaluator and reports invalid saved sequences', () => {
    const pool = buildRecipeCandidatePool(
      'seasoner-unlocked',
      [saved('stale', ['unknown-future-ingredient'])],
    )

    expect(pool.entries.some(
      (entry) => entry.savedRecipeIds.includes('stale'),
    )).toBe(false)
    expect(pool.rejectedSavedRecipes).toEqual([
      {
        savedRecipeId: 'stale',
        issues: [
          {
            code: 'unknown-ingredient',
            ingredientId: 'unknown-future-ingredient',
            message: '未知原料：unknown-future-ingredient',
          },
          {
            code: 'invalid-base',
            ingredientId: 'unknown-future-ingredient',
            message: '配方順序必須從果汁基底開始。',
          },
        ],
      },
    ])
  })

  it('feeds customer matching and optimizer modeling the same progressive candidate ids and eligibility decisions', () => {
    const pool = buildRecipeCandidatePool('seasoner-unlocked')
    const customer: Customer = {
      id: 'fixture',
      name: '測試顧客',
      occupation: '測試',
      villageId: 'east-harbor',
      satisfactionRequired: 0,
      preferences: [
        { kind: 'effect', value: '舒緩腸胃' },
        { kind: 'effect', value: '芳香' },
      ],
    }
    const search = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      customer,
      { candidatePolicy: 'allow-unambiguous-computed' },
    )

    expect(search.usedRepeatedSeasoningFallback).toBe(true)

    const matchingIds = matchingRecipeCandidatesForCustomer(
      [...search.candidates],
      customer,
    ).map((candidate) => candidate.id).sort()

    const request: OptimizationRequest = {
      customerIds: [customer.id],
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 0,
        'tranquil-fountain': 0,
      },
      formalCustomerIds: [],
      currentProgress: 'seasoner-unlocked',
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-cost',
    }
    const model = buildOptimizationModel(request, {
      customers: [customer],
      candidatePool: pool,
    })
    const optimizerIds = model.recipes
      .map((recipe) => recipe.candidate.id)
      .sort()

    expect(optimizerIds).toEqual(matchingIds)
  })
})
