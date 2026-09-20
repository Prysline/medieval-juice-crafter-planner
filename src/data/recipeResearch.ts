import type { EffectValue } from '../types'

export interface RecipeResearchObservation {
  ingredients: string[]
  salePrice: number
  effects: EffectValue[]
  note?: string
}

/**
 * Observed longer seasoning sequences used to infer game mechanics.
 * These are intentionally not shown in the normal recipe database.
 */
export const recipeResearchObservations: RecipeResearchObservation[] = [
  {
    ingredients: ['橙子', '糖', '薄荷', '糖'],
    salePrice: 42,
    effects: [
      { name: '甜味', value: 10 },
      { name: '補充精力', value: 6 },
      { name: '清新口氣', value: 4 },
      { name: '增強免疫', value: 4 },
    ],
  },
  {
    ingredients: ['橙子', '糖', '薄荷', '薄荷'],
    salePrice: 42,
    effects: [
      { name: '清新口氣', value: 8 },
      { name: '舒緩腸胃', value: 6 },
      { name: '芳香', value: 5 },
      { name: '甜味', value: 5 },
    ],
    note: 'Game-name prefix observed as 清口, supporting dominant-effect prefix hypothesis.',
  },
  {
    ingredients: ['橙子', '糖', '薄荷', '糖', '薄荷'],
    salePrice: 42,
    effects: [
      { name: '甜味', value: 10 },
      { name: '清新口氣', value: 8 },
      { name: '舒緩腸胃', value: 6 },
      { name: '補充精力', value: 6 },
    ],
  },
  {
    ingredients: ['橙子', '糖', '薄荷', '糖', '薄荷', '薄荷'],
    salePrice: 42,
    effects: [
      { name: '清新口氣', value: 12 },
      { name: '甜味', value: 10 },
      { name: '舒緩腸胃', value: 9 },
      { name: '芳香', value: 7 },
    ],
  },
]
