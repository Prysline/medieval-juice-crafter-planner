import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import { generateRecipeCandidates } from './recipeGenerator'
import {
  bestFullMatchRecommendation,
  cheapestFullMatchRecommendation,
  customerFullMatchAvailability,
  customerRecipeRecommendations,
  recommendationDisplayItems,
  sortFullMatchCandidatesByIngredientCost,
} from './customerRecommendation'
import type { Customer, Recipe, RecipeCandidate } from '../types'

const syntheticCustomer: Customer = {
  id: 'fixture',
  name: '測試顧客',
  occupation: '測試',
  villageId: 'east-harbor',
  satisfactionRequired: 0,
  preferences: [{ kind: 'effect', value: '甜味' }],
}

function fixtureCandidate(
  id: string,
  ingredients: string[],
  source: RecipeCandidate['source'] = 'observed',
): RecipeCandidate {
  return {
    id,
    name: id,
    source,
    unlockedAt: 'seasoner-unlocked',
    salePrice: source === 'observed' ? 99 : null,
    ingredients,
    effects: [{ name: '甜味', value: 5 }],
    equipment: [],
  }
}

describe('customer lowest-cost recommendations', () => {
  it('chooses the lowest ingredient cost full match', () => {
    const recommendation = cheapestFullMatchRecommendation(
      [
        fixtureCandidate('expensive', ['橙子', '薄荷']),
        fixtureCandidate('cheap', ['檸檬', '糖']),
      ],
      syntheticCustomer,
      'observed-only',
    )

    expect(recommendation?.batchIngredientCost).toBe(16)
    expect(recommendation?.unitIngredientCost).toBe(8)
    expect(recommendation?.candidates.map(({ candidate }) => candidate.id)).toEqual([
      'cheap',
    ])
  })

  it('can choose the highest ingredient cost full match', () => {
    const recommendation = bestFullMatchRecommendation(
      [
        fixtureCandidate('expensive', ['橙子', '薄荷']),
        fixtureCandidate('cheap', ['檸檬', '糖']),
      ],
      syntheticCustomer,
      'observed-only',
      'maximum',
    )

    expect(recommendation?.costMode).toBe('maximum')
    expect(recommendation?.batchIngredientCost).toBe(25)
    expect(
      recommendation?.candidates.map(({ candidate }) => candidate.id),
    ).toEqual(['expensive'])
  })

  it('prefers unique ingredients for highest-cost prediction even when a repeated recipe costs more', () => {
    const recommendation = bestFullMatchRecommendation(
      [
        fixtureCandidate('unique', ['橙子', '薄荷']),
        fixtureCandidate('repeated-expensive', ['橙子', '薄荷', '薄荷']),
      ],
      syntheticCustomer,
      'observed-only',
      'maximum',
    )

    expect(recommendation?.candidates.map(({ candidate }) => candidate.id)).toEqual([
      'unique',
    ])
    expect(recommendation?.batchIngredientCost).toBe(25)
  })

  it('falls back to repeated ingredients for highest-cost prediction when no unique full match exists', () => {
    const recommendation = bestFullMatchRecommendation(
      [
        fixtureCandidate('repeated-only', ['橙子', '薄荷', '薄荷']),
      ],
      syntheticCustomer,
      'observed-only',
      'maximum',
    )

    expect(recommendation?.candidates.map(({ candidate }) => candidate.id)).toEqual([
      'repeated-only',
    ])
    expect(recommendation?.batchIngredientCost).toBe(39)
  })

  it('sorts full matches by ingredient cost in the selected direction', () => {
    const cheap = fixtureCandidate('cheap', ['檸檬', '糖'])
    const expensive = fixtureCandidate('expensive', ['橙子', '薄荷'])

    expect(
      sortFullMatchCandidatesByIngredientCost(
        [expensive, cheap],
        'minimum',
      ).map((candidate) => candidate.id),
    ).toEqual(['cheap', 'expensive'])
    expect(
      sortFullMatchCandidatesByIngredientCost(
        [cheap, expensive],
        'maximum',
      ).map((candidate) => candidate.id),
    ).toEqual(['expensive', 'cheap'])

    const repeated = fixtureCandidate(
      'repeated-expensive',
      ['橙子', '薄荷', '薄荷'],
    )
    expect(
      sortFullMatchCandidatesByIngredientCost(
        [cheap, expensive, repeated],
        'maximum',
      ).map((candidate) => candidate.id),
    ).toEqual(['expensive', 'cheap'])
    expect(
      sortFullMatchCandidatesByIngredientCost(
        [repeated],
        'maximum',
      ).map((candidate) => candidate.id),
    ).toEqual(['repeated-expensive'])
  })

  it('keeps every tied cheapest recipe instead of inventing a tie-break', () => {
    const recommendation = cheapestFullMatchRecommendation(
      [
        fixtureCandidate('first', ['檸檬', '糖']),
        fixtureCandidate('second', ['糖', '檸檬']),
      ],
      syntheticCustomer,
      'observed-only',
    )

    expect(recommendation?.candidates.map(({ candidate }) => candidate.id)).toEqual([
      'first',
      'second',
    ])
  })

  it('keeps observed-only and allow-computed recommendations separate', () => {
    const recommendations = customerRecipeRecommendations(
      [
        fixtureCandidate('observed', ['橙子', '糖'], 'observed'),
        fixtureCandidate('computed', ['檸檬', '糖'], 'computed'),
      ],
      syntheticCustomer,
    )

    expect(
      recommendations.observedOnly?.candidates[0].candidate.id,
    ).toBe('observed')
    expect(
      recommendations.allowComputed?.candidates[0].candidate.id,
    ).toBe('computed')
  })

  it('deduplicates one recipe that is best for multiple recommendation reasons', () => {
    const observed = fixtureCandidate(
      'observed',
      ['檸檬', '糖'],
      'observed',
    )
    const observedRecommendation = bestFullMatchRecommendation(
      [observed],
      syntheticCustomer,
      'observed-only',
      'minimum',
    )
    const broadRecommendation = bestFullMatchRecommendation(
      [observed],
      syntheticCustomer,
      'allow-unambiguous-computed',
      'minimum',
    )

    const displayItems = recommendationDisplayItems({
      observedOnly: observedRecommendation,
      allowComputed: broadRecommendation,
    })

    expect(displayItems).toHaveLength(1)
    expect(displayItems[0].candidate.id).toBe('observed')
    expect(displayItems[0].reasons).toEqual([
      '已實測最低成本',
      '目前可製作最低成本',
    ])
  })

  it('classifies current, future, ambiguous, and bounded-search full-match states without overclaiming', () => {
    const observed = fixtureCandidate(
      'observed',
      ['檸檬', '糖'],
      'observed',
    )
    const computed = fixtureCandidate(
      'computed',
      ['檸檬', '糖'],
      'computed',
    )
    const futureObserved: Recipe = {
      id: 'future-observed',
      name: '未來實測配方',
      unlockedAt: 'juice-blender-unlocked',
      salePrice: 50,
      ingredients: ['檸檬', '糖'],
      effects: [{ name: '甜味', value: 5 }],
      equipment: ['果汁調和器'],
    }
    const ambiguous = fixtureCandidate(
      'ambiguous',
      ['檸檬', '糖'],
      'computed',
    )
    ambiguous.effects = []
    ambiguous.effectAmbiguity = {
      cutoffValue: 5,
      remainingSlots: 1,
      candidates: [{ name: '甜味', value: 5 }],
    }

    expect(
      customerFullMatchAvailability({
        customer: syntheticCustomer,
        currentProgress: 'seasoner-unlocked',
        currentFullMatches: [observed],
        searchedCandidates: [observed],
        knownObservedRecipes: [futureObserved],
        searchTruncated: false,
      }).kind,
    ).toBe('observed-current')

    expect(
      customerFullMatchAvailability({
        customer: syntheticCustomer,
        currentProgress: 'seasoner-unlocked',
        currentFullMatches: [computed],
        searchedCandidates: [computed],
        knownObservedRecipes: [futureObserved],
        searchTruncated: false,
      }).kind,
    ).toBe('safe-current')

    const future = customerFullMatchAvailability({
      customer: syntheticCustomer,
      currentProgress: 'seasoner-unlocked',
      currentFullMatches: [],
      searchedCandidates: [],
      knownObservedRecipes: [futureObserved],
      searchTruncated: false,
    })
    expect(future.kind).toBe('future-observed')
    expect(future.futureObservedMatches.map((recipe) => recipe.id)).toEqual([
      'future-observed',
    ])

    const ambiguousOnly = customerFullMatchAvailability({
      customer: syntheticCustomer,
      currentProgress: 'seasoner-unlocked',
      currentFullMatches: [],
      searchedCandidates: [ambiguous],
      knownObservedRecipes: [],
      searchTruncated: false,
    })
    expect(ambiguousOnly.kind).toBe('ambiguous-only')
    expect(
      ambiguousOnly.ambiguousCandidates.map((candidate) => candidate.id),
    ).toEqual(['ambiguous'])

    const none = customerFullMatchAvailability({
      customer: syntheticCustomer,
      currentProgress: 'seasoner-unlocked',
      currentFullMatches: [],
      searchedCandidates: [],
      knownObservedRecipes: [],
      searchTruncated: true,
    })
    expect(none.kind).toBe('none-in-search-scope')
    expect(none.searchTruncated).toBe(true)
  })

  it('never recommends an ambiguous computed candidate', () => {
    const ambiguous = fixtureCandidate(
      'ambiguous',
      ['檸檬', '糖'],
      'computed',
    )
    ambiguous.effectAmbiguity = {
      cutoffValue: 3,
      remainingSlots: 1,
      candidates: [
        { name: '增強免疫', value: 3 },
        { name: '補充精力', value: 3 },
      ],
    }

    expect(
      cheapestFullMatchRecommendation(
        [ambiguous],
        syntheticCustomer,
        'allow-unambiguous-computed',
      ),
    ).toBeNull()
  })

  it('does not let future-progress ingredients pollute earlier recommendations', () => {
    const betty = customers.find((customer) => customer.id === 'betty')
    expect(betty).toBeDefined()

    const juicerRecommendation = customerRecipeRecommendations(
      generateRecipeCandidates('juicer-unlocked'),
      betty!,
    )
    const fountainRecommendation = customerRecipeRecommendations(
      generateRecipeCandidates('tranquil-fountain-unlocked'),
      betty!,
    )

    expect(juicerRecommendation.allowComputed).toBeNull()
    expect(fountainRecommendation.allowComputed).not.toBeNull()
  })
})
