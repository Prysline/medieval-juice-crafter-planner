import type { Ingredient } from '../types'

export const ingredients: Ingredient[] = [
  {
    id: 'lemon',
    name: '檸檬',
    stage: 1,
    buyPrice: 9,
    seller: '檸檬商人',
    effects: [
      { name: '酸味', value: 4 },
      { name: '增強免疫', value: 3 },
      { name: '保護心臟', value: 1 },
      { name: '輔助瘦身', value: 1 },
    ],
  },
  {
    id: 'orange',
    name: '橙子',
    stage: 1,
    buyPrice: 11,
    seller: '蔬果商',
    effects: [
      { name: '增強免疫', value: 4 },
      { name: '煥亮肌膚', value: 2 },
      { name: '芳香', value: 1 },
      { name: '保護心臟', value: 1 },
      { name: '提神醒腦', value: 1 },
    ],
  },
  {
    id: 'mint',
    name: '薄荷',
    stage: 2,
    buyPrice: 14,
    seller: '薄荷商人',
    effects: [
      { name: '清新口氣', value: 4 },
      { name: '舒緩腸胃', value: 3 },
      { name: '芳香', value: 2 },
      { name: '紓解壓力', value: 1 },
      { name: '增強腦力', value: 1 },
    ],
  },
  {
    id: 'sugar',
    name: '糖',
    stage: 2,
    buyPrice: 7,
    seller: '售糖商人',
    effects: [
      { name: '甜味', value: 5 },
      { name: '補充精力', value: 3 },
    ],
  },
  {
    id: 'carrot',
    name: '紅蘿蔔',
    stage: 4,
    buyPrice: 10,
    seller: '蔬果商',
    effects: [
      { name: '改善視力', value: 4 },
      { name: '調節血糖', value: 3 },
      { name: '防止過食', value: 2 },
      { name: '增強免疫', value: 1 },
    ],
  },
  {
    id: 'pear',
    name: '梨',
    stage: 4,
    buyPrice: 13,
    seller: '蔬果商',
    effects: [
      { name: '促進消化', value: 4 },
      { name: '保護心臟', value: 3 },
      { name: '輔助瘦身', value: 1 },
    ],
  },
]
