import type { Ingredient } from '../types'

export type RecipeIngredientRole = 'juice-base' | 'seasoning'

export interface RecipeIngredientCapability {
  ingredientId: Ingredient['id']
  roles: RecipeIngredientRole[]
  /** 作為果汁基底時所需的第一段榨汁設備。 */
  baseEquipment?: '柑橘榨汁機' | '榨汁機'
}

/**
 * 原料在配方 sequence 中可扮演的角色。
 *
 * 自動 generator 仍只枚舉「一種果汁基底 + 0～2 種不重複調味材料」，
 * 這是候選枚舉範圍，不是 simulator/evaluator 的上限。
 *
 * 手動 simulator 可保留重複調味與四原料以上 sequence；第二個 juice-base
 * 代表下一杯飲料的 sequence 開始，整體以果汁調和器串接。
 *
 * 果汁調和器的遊戲內精確輸入比例、產量與售價公式仍未確認；網站只把
 * 使用者指定的兩杯飲料 ordered sequence 做 concat，不自行推導這些未知值。
 */
export const recipeIngredientCapabilities: RecipeIngredientCapability[] = [
  { ingredientId: 'lemon', roles: ['juice-base'], baseEquipment: '柑橘榨汁機' },
  { ingredientId: 'orange', roles: ['juice-base'], baseEquipment: '柑橘榨汁機' },
  { ingredientId: 'carrot', roles: ['juice-base'], baseEquipment: '榨汁機' },
  { ingredientId: 'pear', roles: ['juice-base'], baseEquipment: '榨汁機' },
  { ingredientId: 'banana', roles: ['juice-base'], baseEquipment: '榨汁機' },
  { ingredientId: 'sugar', roles: ['seasoning'] },
  { ingredientId: 'mint', roles: ['seasoning'] },
  { ingredientId: 'cinnamon', roles: ['seasoning'] },
]
