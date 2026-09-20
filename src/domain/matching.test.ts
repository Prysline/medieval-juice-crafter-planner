import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
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
    expect(orangeSugarMint?.effects).toContain('舒緩腸胃')
    expect(orangeSugarMint?.effects).not.toContain('補充精力')
    expect(orangeMintSugar?.effects).toContain('補充精力')
    expect(lemonSugarMint?.gameNameExamples).toEqual(['甜味 勇氣', '甜味 輕吻'])
  })

  it('does not expose stage-two recipes at stage one', () => {
    const jack = customers.find((customer) => customer.id === 'jack')
    expect(jack).toBeDefined()

    const matches = matchingRecipesForCustomer(recipes, jack!, 1)
    expect(matches.map((recipe) => recipe.name)).toEqual(['橙汁'])
  })
})
