import type { EffectValue } from '../types'

export interface RecipeResearchObservation {
  ingredients: string[]
  salePrice: number
  effects: EffectValue[]
  /** 遊戲名稱中觀察到的前綴；只用來研究命名規則，不作為配方名稱保存。 */
  observedPrefix?: string
}

/**
 * 四原料以上的重複調味實測。
 *
 * 這些資料只用來研究特性累加、slot、同分排序與售價規則，
 * 不會出現在一般配方資料庫。
 *
 * 目前已確認的單一果汁基底＋調味器售價研究邊界：
 * - 相同 unique ingredient set 時，加入順序不改變售價。
 * - 重複加入集合內已存在的原料，不提高售價。
 * 這些結論只作 research / regression，不用來推導 computed candidate 售價，
 * 也不外推到果汁調和器成品。
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
    observedPrefix: '清口',
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
