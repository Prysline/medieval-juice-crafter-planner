import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import { recipes } from '../data/recipes'
import type { Recipe } from '../types'
import {
  filterSuppliedCustomerRows,
  sortCustomerRows,
  type CustomerListRow,
} from './customerList'

function row(customerId: string, matches: Recipe[] = []): CustomerListRow {
  const customer = customers.find((item) => item.id === customerId)
  if (!customer) throw new Error(`Missing fixture customer: ${customerId}`)

  return { customer, unlocked: true, matches }
}

describe('customer list regressions', () => {
  const recipeOrder = new Map(recipes.map((recipe, index) => [recipe.id, index]))
  const lemon = recipes.find((recipe) => recipe.id === 'lemon-juice')!
  const orange = recipes.find((recipe) => recipe.id === 'orange-juice')!

  it('can hide supplied customers without changing the source rows', () => {
    const rows = [row('jack', [orange]), row('nanette', [lemon])]

    expect(
      filterSuppliedCustomerRows(rows, ['jack'], false).map(
        ({ customer }) => customer.id,
      ),
    ).toEqual(['nanette'])
    expect(rows).toHaveLength(2)
  })

  it('keeps supplied customers when the display toggle is on', () => {
    const rows = [row('jack', [orange]), row('nanette', [lemon])]

    expect(
      filterSuppliedCustomerRows(rows, ['jack'], true).map(
        ({ customer }) => customer.id,
      ),
    ).toEqual(['jack', 'nanette'])
  })

  it('keeps best-match grouping based on stable recipe order', () => {
    const rows = [
      row('jack', [orange]),
      row('nanette', [lemon]),
      row('derrick'),
    ]

    expect(
      sortCustomerRows(rows, 'bestMatch', 'asc', recipeOrder).map(
        ({ customer }) => customer.id,
      ),
    ).toEqual(['nanette', 'jack', 'derrick'])
  })

  it('keeps customers without a match after matched customers when sorting by price', () => {
    const rows = [
      row('derrick'),
      row('jack', [orange]),
      row('nanette', [lemon]),
    ]

    expect(
      sortCustomerRows(rows, 'bestPrice', 'desc', recipeOrder).map(
        ({ customer }) => customer.id,
      ),
    ).toEqual(['jack', 'nanette', 'derrick'])
  })
})
