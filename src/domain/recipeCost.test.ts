import { describe, expect, it } from 'vitest'
import type { RecipeCandidate } from '../types'
import {
  calculateRecipeIngredientCost,
  RECIPE_BATCH_YIELD,
} from './recipeCost'

function candidate(ingredients: string[]): RecipeCandidate {
  return {
    id: 'fixture',
    name: 'fixture',
    source: 'computed',
    unlockedAt: 'seasoner-unlocked',
    salePrice: null,
    ingredients,
    effects: [],
    equipment: [],
  }
}

describe('recipe ingredient cost', () => {
  it('uses the confirmed two-serving batch yield', () => {
    expect(RECIPE_BATCH_YIELD).toBe(2)
  })

  it('calculates batch and unit ingredient cost', () => {
    expect(calculateRecipeIngredientCost(candidate(['檸檬', '糖']))).toEqual({
      batchIngredientCost: 16,
      unitIngredientCost: 8,
      missingIngredients: [],
    })
  })

  it('preserves ingredient order without changing cost', () => {
    const sugarMint = calculateRecipeIngredientCost(
      candidate(['橙子', '糖', '薄荷']),
    )
    const mintSugar = calculateRecipeIngredientCost(
      candidate(['橙子', '薄荷', '糖']),
    )

    expect(sugarMint.batchIngredientCost).toBe(32)
    expect(mintSugar.batchIngredientCost).toBe(32)
  })

  it('returns unknown cost instead of inventing a price', () => {
    expect(
      calculateRecipeIngredientCost(candidate(['檸檬', '未知原料'])),
    ).toEqual({
      batchIngredientCost: null,
      unitIngredientCost: null,
      missingIngredients: ['未知原料'],
    })
  })
})
