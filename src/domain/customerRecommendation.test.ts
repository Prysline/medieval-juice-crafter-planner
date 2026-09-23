import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import { generateRecipeCandidates } from './recipeGenerator'
import {
  bestFullMatchRecommendation,
  cheapestFullMatchRecommendation,
  customerRecipeRecommendations,
  sortFullMatchCandidatesByIngredientCost,
} from './customerRecommendation'
import type { Customer, RecipeCandidate } from '../types'

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
