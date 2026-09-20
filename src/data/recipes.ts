import type { Recipe } from '../types'

/**
 * Canonical recipes shown in the normal planner database.
 *
 * For now we intentionally keep fixed entries to at most three ingredients.
 * Longer repeated-seasoning sequences are useful for researching the effect
 * formula, but they explode combinatorially and currently provide no observed
 * sale-price benefit. Those observations live in recipeResearch.ts instead.
 */
export const recipes: Recipe[] = [
  {
    id: 'lemon-juice',
    name: '檸檬汁',
    stage: 1,
    salePrice: 9,
    ingredients: ['檸檬'],
    effects: [
      { name: '酸味', value: 4 },
      { name: '增強免疫', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '果汁成品台'],
  },
  {
    id: 'orange-juice',
    name: '橙汁',
    stage: 1,
    salePrice: 11,
    ingredients: ['橙子'],
    effects: [
      { name: '增強免疫', value: 4 },
      { name: '煥亮肌膚', value: 2 },
    ],
    equipment: ['柑橘榨汁機', '果汁成品台'],
  },
  {
    id: 'orange-sugar',
    name: '橙子 - 糖（調製飲品）',
    stage: 2,
    salePrice: 22,
    ingredients: ['橙子', '糖'],
    effects: [
      { name: '甜味', value: 5 },
      { name: '增強免疫', value: 4 },
      { name: '補充精力', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '果汁成品台'],
  },
  {
    id: 'lemon-mint',
    name: '檸檬 - 薄荷（調製飲品）',
    stage: 2,
    salePrice: 28,
    ingredients: ['檸檬', '薄荷'],
    effects: [
      { name: '清新口氣', value: 4 },
      { name: '酸味', value: 4 },
      { name: '舒緩腸胃', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '果汁成品台'],
  },
  {
    id: 'orange-mint',
    name: '橙子 - 薄荷（調製飲品）',
    stage: 2,
    salePrice: 30,
    ingredients: ['橙子', '薄荷'],
    effects: [
      { name: '清新口氣', value: 4 },
      { name: '增強免疫', value: 4 },
      { name: '舒緩腸胃', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '果汁成品台'],
  },
  {
    id: 'lemon-sugar',
    name: '檸檬 - 糖（調製飲品）',
    stage: 2,
    salePrice: 19,
    ingredients: ['檸檬', '糖'],
    effects: [
      { name: '甜味', value: 5 },
      { name: '酸味', value: 4 },
      { name: '補充精力', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '果汁成品台'],
  },
  {
    id: 'orange-sugar-mint',
    name: '甜味（橙子 → 糖 → 薄荷）',
    stage: 2,
    salePrice: 42,
    ingredients: ['橙子', '糖', '薄荷'],
    effects: [
      { name: '甜味', value: 5 },
      { name: '清新口氣', value: 4 },
      { name: '增強免疫', value: 4 },
      { name: '舒緩腸胃', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '果汁成品台'],
  },
  {
    id: 'orange-mint-sugar',
    name: '甜味（橙子 → 薄荷 → 糖）',
    stage: 2,
    salePrice: 42,
    ingredients: ['橙子', '薄荷', '糖'],
    effects: [
      { name: '甜味', value: 5 },
      { name: '清新口氣', value: 4 },
      { name: '增強免疫', value: 4 },
      { name: '補充精力', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '果汁成品台'],
  },
  {
    id: 'lemon-sugar-mint',
    name: '甜味（檸檬 → 糖 → 薄荷）',
    stage: 2,
    salePrice: 39,
    ingredients: ['檸檬', '糖', '薄荷'],
    effects: [
      { name: '甜味', value: 5 },
      { name: '清新口氣', value: 4 },
      { name: '酸味', value: 4 },
      { name: '舒緩腸胃', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '果汁成品台'],
  },
  {
    id: 'lemon-mint-sugar',
    name: '甜味（檸檬 → 薄荷 → 糖）',
    stage: 2,
    salePrice: 39,
    ingredients: ['檸檬', '薄荷', '糖'],
    effects: [
      { name: '甜味', value: 5 },
      { name: '清新口氣', value: 4 },
      { name: '酸味', value: 4 },
      { name: '補充精力', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '果汁成品台'],
  },
]
