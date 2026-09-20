import type { Ingredient } from '../types'

export const ingredients: Ingredient[] = [
  {
    id: 'lemon',
    name: '檸檬',
    stage: 1,
    buyPrice: 9,
    seller: '檸檬商人',
    effects: ['酸味', '增強免疫', '保護心臟', '輔助瘦身'],
  },
  {
    id: 'orange',
    name: '橙子',
    stage: 1,
    buyPrice: 11,
    seller: '蔬果商',
    effects: ['增強免疫', '煥亮肌膚', '芳香', '保護心臟', '提神醒腦'],
  },
  {
    id: 'mint',
    name: '薄荷',
    stage: 2,
    buyPrice: 14,
    seller: '薄荷商人',
    effects: ['清新口氣', '舒緩腸胃', '芳香', '紓解壓力', '增強腦力'],
  },
  {
    id: 'sugar',
    name: '糖',
    stage: 2,
    buyPrice: 7,
    seller: '售糖商人',
    effects: ['甜味', '補充精力'],
  },
]
