import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import { recipeResearchObservations } from '../data/recipeResearch'
import { recipes } from '../data/recipes'
import {
  matchingRecipesForCustomer,
  partialMatchingRecipesForCustomer,
  recipeMatchLevel,
} from './matching'

describe('customer recipe matching', () => {
  it('requires every known preference for the default full match', () => {
    const nanette = customers.find((customer) => customer.id === 'nanette')
    expect(nanette).toBeDefined()

    const matches = matchingRecipesForCustomer(recipes, nanette!, 2)

    expect(matches.map((recipe) => recipe.name)).toEqual(['檸檬汁'])
  })

  it('also keeps Katrin strict: only pure lemon fully satisfies acid + immunity', () => {
    const katrin = customers.find((customer) => customer.id === 'katrin')
    expect(katrin).toBeDefined()

    const matches = matchingRecipesForCustomer(recipes, katrin!, 2)
    expect(matches.map((recipe) => recipe.name)).toEqual(['檸檬汁'])
  })

  it('keeps partial matches separate from accepted full matches', () => {
    const nanette = customers.find((customer) => customer.id === 'nanette')
    const lemonMint = recipes.find((recipe) => recipe.id === 'lemon-mint')

    expect(nanette).toBeDefined()
    expect(lemonMint).toBeDefined()
    expect(recipeMatchLevel(lemonMint!, nanette!)).toBe('partial')

    const partialMatches = partialMatchingRecipesForCustomer(recipes, nanette!, 2)
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

  it('keeps the normal recipe database capped at three ingredients for now', () => {
    expect(Math.max(...recipes.map((recipe) => recipe.ingredients.length))).toBe(3)
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

    const matches = matchingRecipesForCustomer(recipes, jack!, 1)
    expect(matches.map((recipe) => recipe.name)).toEqual(['橙汁'])
  })
})
