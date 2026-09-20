import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import { recipes } from '../data/recipes'
import { matchingRecipesForCustomer } from './matching'

describe('matchingRecipesForCustomer', () => {
  it('matches ingredient and effect preferences', () => {
    const nanette = customers.find((customer) => customer.id === 'nanette')
    expect(nanette).toBeDefined()

    const matches = matchingRecipesForCustomer(recipes, nanette!, 2)

    expect(matches[0]?.name).toBe('甜味 星塵')
    expect(matches.some((recipe) => recipe.name === '檸檬汁')).toBe(true)
    expect(matches.some((recipe) => recipe.name === '橙子 - 糖（調製飲品）')).toBe(true)
  })

  it('does not expose stage-two recipes at stage one', () => {
    const jack = customers.find((customer) => customer.id === 'jack')
    expect(jack).toBeDefined()

    const matches = matchingRecipesForCustomer(recipes, jack!, 1)
    expect(matches.map((recipe) => recipe.name)).toEqual(['橙汁'])
  })
})
