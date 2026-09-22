import { describe, expect, it } from 'vitest'
import type {
  Customer,
  Preference,
  RecipeCandidate,
} from '../types'
import {
  buildRecipeCandidatePool,
  type RecipeCandidatePool,
} from './recipeCandidatePool'
import { customerRecipeRecommendationsFromSearch } from './customerRecommendation'
import { matchingRecipeCandidatesForCustomer } from './matching'
import {
  RECIPE_SEARCH_LAYER_CANDIDATE_LIMIT,
  RECIPE_SEARCH_TOTAL_CANDIDATE_LIMIT,
} from './recipeGenerator'
import { searchRecipeCandidatesForCustomer } from './recipeSearch'

function customer(
  preferences: Preference[],
): Customer {
  return {
    id: 'fixture',
    name: '測試顧客',
    occupation: '測試',
    villageId: 'east-harbor',
    satisfactionRequired: 0,
    preferences,
  }
}

function fixtureCandidate(
  id: string,
  ingredients: string[],
  source: RecipeCandidate['source'],
  effects: RecipeCandidate['effects'],
  ambiguous = false,
): RecipeCandidate {
  return {
    id,
    name: id,
    source,
    unlockedAt: 'opening',
    salePrice: source === 'observed' ? 10 : null,
    ingredients,
    effects,
    equipment: [],
    ...(ambiguous
      ? {
          effectAmbiguity: {
            cutoffValue: 1,
            remainingSlots: 1,
            candidates: [{ name: '其他', value: 1 }],
          },
        }
      : {}),
  }
}

function syntheticPool(
  layers: {
    seasoningDepth: number
    candidate: RecipeCandidate
  }[],
): RecipeCandidatePool {
  return {
    entries: layers.map(({ candidate }) => ({
      id: candidate.id,
      ingredientIds: candidate.ingredients,
      candidate,
      sources: [
        candidate.source === 'observed'
          ? 'observed'
          : candidate.effectAmbiguity
            ? 'ambiguous-computed'
            : 'computed',
      ],
      savedRecipeIds: [],
      availableAtCurrentProgress: true,
      inGeneratedSearchScope: true,
    })),
    generatedLayers: layers.map(({ seasoningDepth, candidate }) => ({
      phase: 'unique',
      seasoningDepth,
      segmentCount: 1,
      ingredientCount: seasoningDepth + 1,
      candidateIds: [candidate.id],
      totalSequenceCount: 1,
      truncated: false,
    })),
    rejectedSavedRecipes: [],
  }
}

describe('progressive recipe search', () => {
  it('stops at the first unique layer with a guaranteed full match', () => {
    const pool = buildRecipeCandidatePool('seasoner-unlocked')
    const result = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      customer([{ kind: 'effect', value: '酸味' }]),
      { candidatePolicy: 'allow-unambiguous-computed' },
    )

    expect(result.guaranteedFullMatchFound).toBe(true)
    expect(result.stoppedAt).toEqual({
      phase: 'unique',
      seasoningDepth: 0,
    })
    expect(result.exploredLayers).toHaveLength(1)
    expect(result.usedRepeatedSeasoningFallback).toBe(false)
  })

  it('keeps deeper comparable full matches in bounded-exhaustive mode', () => {
    const shallow = {
      ...fixtureCandidate(
        'shallow-expensive',
        ['橙子', '肉桂'],
        'observed',
        [{ name: '甜味', value: 5 }],
      ),
      salePrice: 20,
    }
    const deeper = {
      ...fixtureCandidate(
        'deeper-cheaper',
        ['檸檬', '糖'],
        'observed',
        [{ name: '甜味', value: 5 }],
      ),
      salePrice: 40,
    }
    const pool = syntheticPool([
      { seasoningDepth: 0, candidate: shallow },
      { seasoningDepth: 1, candidate: deeper },
    ])
    const target = customer([{ kind: 'effect', value: '甜味' }])

    const firstFeasible = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      target,
      {
        candidatePolicy: 'observed-only',
        mode: 'first-feasible',
      },
    )
    const exhaustive = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      target,
      {
        candidatePolicy: 'observed-only',
        mode: 'bounded-exhaustive',
      },
    )

    expect(firstFeasible.candidates.map((candidate) => candidate.id)).toEqual([
      shallow.id,
    ])
    expect(firstFeasible.stoppedAt?.seasoningDepth).toBe(0)
    expect(exhaustive.candidates.map((candidate) => candidate.id)).toEqual([
      shallow.id,
      deeper.id,
    ])
    expect(exhaustive.guaranteedFullMatchFound).toBe(true)
    expect(exhaustive.stoppedAt).toBeNull()
    expect(exhaustive.exploredLayers).toHaveLength(2)

    const matches = matchingRecipeCandidatesForCustomer(
      [...exhaustive.candidates],
      target,
    )
    expect(matches[0].id).toBe(deeper.id)

    const recommendations = customerRecipeRecommendationsFromSearch(
      exhaustive.candidates,
      exhaustive.candidates,
      target,
    )
    expect(
      recommendations.observedOnly?.candidates.map(
        (item) => item.candidate.id,
      ),
    ).toEqual([deeper.id])
  })

  it('does not turn repeated seasoning into normal bounded enumeration after a unique match', () => {
    const pool = buildRecipeCandidatePool('seasoner-unlocked')
    const result = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      customer([{ kind: 'effect', value: '酸味' }]),
      {
        candidatePolicy: 'allow-unambiguous-computed',
        mode: 'bounded-exhaustive',
      },
    )

    expect(result.guaranteedFullMatchFound).toBe(true)
    expect(result.stoppedAt).toBeNull()
    expect(result.usedRepeatedSeasoningFallback).toBe(false)
    expect(
      result.exploredLayers.every((layer) => layer.phase === 'unique'),
    ).toBe(true)
  })

  it('expands through the third unique-seasoning layer when shallower layers are insufficient', () => {
    const pool = buildRecipeCandidatePool(
      'tranquil-fountain-unlocked',
    )
    const result = searchRecipeCandidatesForCustomer(
      pool,
      'tranquil-fountain-unlocked',
      customer([
        { kind: 'effect', value: '甜味' },
        { kind: 'effect', value: '芳香' },
      ]),
      { candidatePolicy: 'allow-unambiguous-computed' },
    )

    expect(result.guaranteedFullMatchFound).toBe(true)
    expect(result.stoppedAt).toEqual({
      phase: 'unique',
      seasoningDepth: 3,
    })
    expect(
      result.candidates.some(
        (candidate) =>
          candidate.ingredients.join(' → ') ===
          '橙子 → 糖 → 薄荷 → 肉桂',
      ),
    ).toBe(true)
    expect(result.usedRepeatedSeasoningFallback).toBe(false)
  })

  it('keeps future Blender layers out of current search before the Blender unlock', () => {
    const pool = buildRecipeCandidatePool(
      'tranquil-fountain-unlocked',
    )
    const result = searchRecipeCandidatesForCustomer(
      pool,
      'tranquil-fountain-unlocked',
      customer([
        { kind: 'ingredient', value: '檸檬' },
        { kind: 'ingredient', value: '梨' },
      ]),
      { candidatePolicy: 'allow-unambiguous-computed' },
    )

    expect(result.guaranteedFullMatchFound).toBe(false)
    expect(
      result.exploredLayers.some((layer) => layer.phase === 'blend'),
    ).toBe(false)
    expect(
      result.candidates.some(
        (candidate) =>
          candidate.ingredients.join(' → ') === '檸檬 → 梨',
      ),
    ).toBe(false)
  })

  it('searches legal Blender layers after unlock and can stop on a two-segment match', () => {
    const pool = buildRecipeCandidatePool('juice-blender-unlocked')
    const result = searchRecipeCandidatesForCustomer(
      pool,
      'juice-blender-unlocked',
      customer([
        { kind: 'ingredient', value: '檸檬' },
        { kind: 'ingredient', value: '梨' },
      ]),
      { candidatePolicy: 'allow-unambiguous-computed' },
    )

    expect(result.guaranteedFullMatchFound).toBe(true)
    expect(result.stoppedAt).toEqual({
      phase: 'blend',
      seasoningDepth: 0,
    })
    const candidate = result.candidates.find(
      (item) =>
        item.ingredients.join(' → ') === '檸檬 → 梨',
    )
    expect(candidate).toMatchObject({
      source: 'computed',
      salePrice: null,
    })
    expect(candidate?.equipment).toContain('果汁調和器')
  })

  it('enables repeated seasoning only after unique layers fail and stops at the first successful fallback layer', () => {
    const pool = buildRecipeCandidatePool('seasoner-unlocked')
    const result = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      customer([
        { kind: 'effect', value: '舒緩腸胃' },
        { kind: 'effect', value: '芳香' },
      ]),
      { candidatePolicy: 'allow-unambiguous-computed' },
    )

    expect(result.usedRepeatedSeasoningFallback).toBe(true)
    expect(result.stoppedAt).toEqual({
      phase: 'repeat-fallback',
      seasoningDepth: 2,
    })
    expect(
      result.candidates.some(
        (candidate) =>
          candidate.ingredients.join(' → ') ===
          '檸檬 → 薄荷 → 薄荷',
      ),
    ).toBe(true)
  })

  it('does not invoke repeated seasoning for an ingredient-only miss', () => {
    const pool = buildRecipeCandidatePool('seasoner-unlocked')
    const result = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      customer([{ kind: 'ingredient', value: '肉桂' }]),
      { candidatePolicy: 'allow-unambiguous-computed' },
    )

    expect(result.guaranteedFullMatchFound).toBe(false)
    expect(result.usedRepeatedSeasoningFallback).toBe(false)
    expect(
      result.exploredLayers.every(
        (layer) => layer.phase === 'unique',
      ),
    ).toBe(true)
  })

  it('does not invoke repeated seasoning when a mixed preference still requires an unavailable ingredient', () => {
    const pool = buildRecipeCandidatePool('seasoner-unlocked')
    const result = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      customer([
        { kind: 'ingredient', value: '肉桂' },
        { kind: 'effect', value: '舒緩腸胃' },
      ]),
      { candidatePolicy: 'allow-unambiguous-computed' },
    )

    expect(result.guaranteedFullMatchFound).toBe(false)
    expect(result.usedRepeatedSeasoningFallback).toBe(false)
    expect(
      result.exploredLayers.every(
        (layer) => layer.phase === 'unique',
      ),
    ).toBe(true)
  })

  it('uses the consumer policy when deciding whether a layer can stop the search', () => {
    const computed = fixtureCandidate(
      'computed',
      ['檸檬'],
      'computed',
      [{ name: '甜味', value: 5 }],
    )
    const observed = fixtureCandidate(
      'observed',
      ['檸檬', '糖'],
      'observed',
      [{ name: '甜味', value: 5 }],
    )
    const pool = syntheticPool([
      { seasoningDepth: 0, candidate: computed },
      { seasoningDepth: 1, candidate: observed },
    ])
    const target = customer([{ kind: 'effect', value: '甜味' }])

    const allowComputed = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      target,
      { candidatePolicy: 'allow-unambiguous-computed' },
    )
    const observedOnly = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      target,
      { candidatePolicy: 'observed-only' },
    )

    expect(allowComputed.stoppedAt?.seasoningDepth).toBe(0)
    expect(observedOnly.stoppedAt?.seasoningDepth).toBe(1)
  })

  it('does not count an ambiguous candidate as a guaranteed full match', () => {
    const ambiguous = fixtureCandidate(
      'ambiguous',
      ['檸檬'],
      'computed',
      [{ name: '甜味', value: 5 }],
      true,
    )
    const safe = fixtureCandidate(
      'safe',
      ['檸檬', '糖'],
      'computed',
      [{ name: '甜味', value: 5 }],
    )
    const pool = syntheticPool([
      { seasoningDepth: 0, candidate: ambiguous },
      { seasoningDepth: 1, candidate: safe },
    ])

    const result = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      customer([{ kind: 'effect', value: '甜味' }]),
      { candidatePolicy: 'allow-unambiguous-computed' },
    )

    expect(result.stoppedAt?.seasoningDepth).toBe(1)
    expect(result.exploredLayers).toHaveLength(2)
  })

  it('keeps fallback budgets finite, deterministic, and inside the current progress gate', () => {
    const pool = buildRecipeCandidatePool('seasoner-unlocked')
    const target = customer([
      { kind: 'effect', value: '不存在特性' },
    ])
    const first = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      target,
      { candidatePolicy: 'allow-unambiguous-computed' },
    )
    const second = searchRecipeCandidatesForCustomer(
      pool,
      'seasoner-unlocked',
      target,
      { candidatePolicy: 'allow-unambiguous-computed' },
    )

    expect(first.candidates.map((candidate) => candidate.id)).toEqual(
      second.candidates.map((candidate) => candidate.id),
    )
    expect(
      new Set(first.candidates.map((candidate) => candidate.id)).size,
    ).toBe(first.candidates.length)
    expect(first.candidates.length).toBeLessThanOrEqual(
      RECIPE_SEARCH_TOTAL_CANDIDATE_LIMIT,
    )
    expect(
      first.exploredLayers.every(
        (layer) =>
          layer.candidateCount <=
          RECIPE_SEARCH_LAYER_CANDIDATE_LIMIT,
      ),
    ).toBe(true)
    expect(
      first.exploredLayers
        .filter((layer) => layer.phase === 'repeat-fallback')
        .map((layer) => layer.seasoningDepth),
    ).toEqual([2, 3, 4, 5])
    expect(
      first.candidates.every(
        (candidate) =>
          candidate.ingredients.length <= 6 &&
          !candidate.ingredients.includes('香蕉') &&
          !candidate.ingredients.includes('肉桂'),
      ),
    ).toBe(true)
  })
})
