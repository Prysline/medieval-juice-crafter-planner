import { describe, expect, it } from 'vitest'
import {
  formatMoney,
  formatRecipeDisplayName,
  formatRecipeIngredientCost,
  formatRecipeSequence,
} from './displayFormat'

describe('shared display formatting', () => {
  it('uses compact recipe separators without half-width spaces', () => {
    expect(formatRecipeSequence(['橙子', '糖', '薄荷'])).toBe(
      '橙子▸糖▸薄荷',
    )
    expect(
      formatRecipeDisplayName('甜味（橙子 → 糖 → 薄荷）'),
    ).toBe('甜味（橙子▸糖▸薄荷）')
    expect(
      formatRecipeDisplayName('橙子 - 糖（調製飲品）'),
    ).toBe('橙子▸糖（調製飲品）')
  })

  it('uses explicit money units for batch and cup costs', () => {
    expect(formatMoney(44)).toBe('44 金幣')
    expect(formatMoney(4.5)).toBe('4.5 金幣')
    expect(formatRecipeIngredientCost(44, 22)).toBe(
      '44 金幣／批 · 22 金幣／杯',
    )
    expect(formatRecipeIngredientCost(null, null)).toBe('未知')
  })
})
