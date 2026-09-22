import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import { recipeResearchObservations } from '../data/recipeResearch'
import { recipes } from '../data/recipes'
import { generateRecipeCandidates } from './recipeGenerator'
import {
  availableRecipes,
  matchingRecipesForCustomer,
  matchingRecipeCandidatesForCustomer,
  partialMatchingRecipesForCustomer,
  recipeCandidateMatchLevel,
  recipeCandidateMatchesCustomer,
  recipeMatchLevel,
} from './matching'

describe('customer recipe matching', () => {
  it('requires every known preference for the default full match', () => {
    const nanette = customers.find((customer) => customer.id === 'nanette')
    expect(nanette).toBeDefined()

    const matches = matchingRecipesForCustomer(recipes, nanette!, 'seasoner-unlocked')

    expect(matches.map((recipe) => recipe.name)).toEqual(['檸檬汁'])
  })

  it('also keeps Katrin strict: only pure lemon fully satisfies acid + immunity', () => {
    const katrin = customers.find((customer) => customer.id === 'katrin')
    expect(katrin).toBeDefined()

    const matches = matchingRecipesForCustomer(recipes, katrin!, 'seasoner-unlocked')
    expect(matches.map((recipe) => recipe.name)).toEqual(['檸檬汁'])
  })

  it('keeps partial matches separate from accepted full matches', () => {
    const nanette = customers.find((customer) => customer.id === 'nanette')
    const lemonMint = recipes.find((recipe) => recipe.id === 'lemon-mint')

    expect(nanette).toBeDefined()
    expect(lemonMint).toBeDefined()
    expect(recipeMatchLevel(lemonMint!, nanette!)).toBe('partial')

    const partialMatches = partialMatchingRecipesForCustomer(recipes, nanette!, 'seasoner-unlocked')
    expect(partialMatches.some((recipe) => recipe.name === '檸檬 - 薄荷（調製飲品）')).toBe(true)
  })

  it('keeps seasoning order as recipe identity for three-ingredient drinks', () => {
    const orangeSugarMint = recipes.find((recipe) => recipe.id === 'orange-sugar-mint')
    const orangeMintSugar = recipes.find((recipe) => recipe.id === 'orange-mint-sugar')
    const lemonSugarMint = recipes.find((recipe) => recipe.id === 'lemon-sugar-mint')

    expect(orangeSugarMint?.salePrice).toBe(42)
    expect(orangeMintSugar?.salePrice).toBe(42)
    expect(orangeSugarMint?.effects.some((effect) => effect.name === '舒緩腸胃')).toBe(true)
    expect(orangeSugarMint?.effects.some((effect) => effect.name === '補充精力')).toBe(false)
    expect(orangeMintSugar?.effects.some((effect) => effect.name === '補充精力')).toBe(true)
    expect(lemonSugarMint?.name).toBe('甜味（檸檬 → 糖 → 薄荷）')
  })

  it('stores confirmed stage-four single-ingredient juices', () => {
    const pearJuice = recipes.find((recipe) => recipe.id === 'pear-juice')
    const carrotJuice = recipes.find((recipe) => recipe.id === 'carrot-juice')

    expect(pearJuice).toMatchObject({
      name: '梨汁',
      unlockedAt: 'juicer-unlocked',
      salePrice: 13,
      ingredients: ['梨'],
    })
    expect(pearJuice?.effects).toEqual([
      { name: '促進消化', value: 4 },
      { name: '保護心臟', value: 3 },
    ])

    expect(carrotJuice).toMatchObject({
      name: '紅蘿蔔汁',
      unlockedAt: 'juicer-unlocked',
      salePrice: 10,
      ingredients: ['紅蘿蔔'],
    })
    expect(carrotJuice?.effects).toEqual([
      { name: '改善視力', value: 4 },
      { name: '調節血糖', value: 3 },
    ])
  })

  it('keeps stage-four pear and carrot seasoning order as recipe identity', () => {
    const pearMintSugar = recipes.find((recipe) => recipe.id === 'pear-mint-sugar')
    const pearSugarMint = recipes.find((recipe) => recipe.id === 'pear-sugar-mint')
    const carrotSugarMint = recipes.find((recipe) => recipe.id === 'carrot-sugar-mint')
    const carrotMintSugar = recipes.find((recipe) => recipe.id === 'carrot-mint-sugar')

    expect(pearMintSugar?.salePrice).toBe(44)
    expect(pearSugarMint?.salePrice).toBe(44)
    expect(pearMintSugar?.effects).toContainEqual({ name: '補充精力', value: 3 })
    expect(pearSugarMint?.effects).toContainEqual({ name: '舒緩腸胃', value: 3 })
    expect(carrotSugarMint?.salePrice).toBe(40)
    expect(carrotSugarMint?.effects).toContainEqual({ name: '舒緩腸胃', value: 3 })
    expect(carrotMintSugar?.effects).toContainEqual({ name: '補充精力', value: 3 })
  })

  it('keeps juicer recipes hidden before juicer-unlocked', () => {
    expect(
      availableRecipes(recipes, 'juice-jar-unlocked').some(
        (recipe) => recipe.id === 'pear-sugar',
      ),
    ).toBe(false)
    expect(
      availableRecipes(recipes, 'juicer-unlocked').some(
        (recipe) => recipe.id === 'pear-sugar',
      ),
    ).toBe(true)
  })

  it('allows directly observed long recipes in the formal recipe database', () => {
    const observedBlend = recipes.find(
      (recipe) => recipe.id === 'lemon-sugar-mint-orange-mint-sugar-blend',
    )

    expect(observedBlend).toMatchObject({
      observedDisplayName: '甜味 非凡',
      salePrice: 57,
      ingredients: ['檸檬', '糖', '薄荷', '橙子', '薄荷', '糖'],
    })
  })

  it('keeps longer repeated-seasoning observations in research data', () => {
    const orangeSugarMintMint = recipeResearchObservations.find(
      (observation) =>
        observation.ingredients.join('|') === '橙子|糖|薄荷|薄荷',
    )
    const sixIngredient = recipeResearchObservations.find(
      (observation) => observation.ingredients.length === 6,
    )

    expect(orangeSugarMintMint?.effects).toEqual([
      { name: '清新口氣', value: 8 },
      { name: '舒緩腸胃', value: 6 },
      { name: '芳香', value: 5 },
      { name: '甜味', value: 5 },
    ])
    expect(sixIngredient?.effects).toContainEqual({ name: '芳香', value: 7 })
  })

  it('does not expose stage-two recipes at stage one', () => {
    const jack = customers.find((customer) => customer.id === 'jack')
    expect(jack).toBeDefined()

    const matches = matchingRecipesForCustomer(recipes, jack!, 'opening')
    expect(matches.map((recipe) => recipe.name)).toEqual(['橙汁'])
  })
  it('allows exact computed candidates to participate in full matching', () => {
    const candidates = generateRecipeCandidates('tranquil-fountain-unlocked')
    const banana = candidates.find(
      (candidate) => candidate.ingredients.join(' → ') === '香蕉',
    )
    const syntheticCustomer = {
      id: 'computed-full-test',
      name: '測試顧客',
      occupation: '測試',
      villageId: 'tranquil-fountain' as const,
      satisfactionRequired: 0,
      preferences: [
        { kind: 'ingredient' as const, value: '香蕉' },
        { kind: 'effect' as const, value: '補充精力' },
      ],
    }

    expect(banana?.source).toBe('computed')
    expect(banana?.effectAmbiguity).toBeUndefined()
    expect(recipeCandidateMatchesCustomer(banana!, syntheticCustomer)).toBe(true)
  })

  it('never claims full match from an ambiguous computed cutoff', () => {
    const candidates = generateRecipeCandidates('tranquil-fountain-unlocked')
    const lemonCinnamonMint = candidates.find(
      (candidate) =>
        candidate.ingredients.join(' → ') === '檸檬 → 肉桂 → 薄荷',
    )
    const syntheticCustomer = {
      id: 'ambiguous-test',
      name: '測試顧客',
      occupation: '測試',
      villageId: 'tranquil-fountain' as const,
      satisfactionRequired: 0,
      preferences: [
        { kind: 'effect' as const, value: '酸味' },
        { kind: 'effect' as const, value: '增強免疫' },
      ],
    }

    expect(lemonCinnamonMint?.source).toBe('computed')
    expect(lemonCinnamonMint?.effectAmbiguity).toBeDefined()
    expect(
      recipeCandidateMatchLevel(
        lemonCinnamonMint!,
        syntheticCustomer,
      ),
    ).toBe('full')
    expect(
      recipeCandidateMatchesCustomer(
        lemonCinnamonMint!,
        syntheticCustomer,
      ),
    ).toBe(false)
  })

  it('sorts known-price observed matches before unknown-price computed matches', () => {
    const candidates = generateRecipeCandidates('tranquil-fountain-unlocked')
    const syntheticCustomer = {
      id: 'price-test',
      name: '測試顧客',
      occupation: '測試',
      villageId: 'tranquil-fountain' as const,
      satisfactionRequired: 0,
      preferences: [{ kind: 'effect' as const, value: '補充精力' }],
    }

    const matches = matchingRecipeCandidatesForCustomer(
      candidates,
      syntheticCustomer,
    )

    const firstUnknownIndex = matches.findIndex(
      (candidate) => candidate.salePrice === null,
    )
    const lastKnownIndex = matches.reduce(
      (last, candidate, index) =>
        candidate.salePrice !== null ? index : last,
      -1,
    )

    expect(lastKnownIndex).toBeGreaterThanOrEqual(0)
    expect(firstUnknownIndex).toBeGreaterThan(lastKnownIndex)
  })
})
