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
 * Candidate-2A 自動搜尋只處理單一果汁段：普通層最多搜尋到
 * 4 種不重複原料（1 個 juice-base + 3 個 seasoning），只有普通層
 * 無保證完全匹配時才啟用有限的 repeated-seasoning fallback。
 * 這些都是網站搜尋 budget，不是 simulator/evaluator 或遊戲規則的上限。
 *
 * 手動 simulator 可保留重複調味與四原料以上 sequence；第二個 juice-base
 * 代表下一杯飲料的 sequence 開始，整體以果汁調和器串接。
 *
 * 果汁調和器已確認可投入任意兩種果汁，比例／產量為 1:1:1、q = 1～5；
 * 網站把不同 drink segment 的 ordered sequence 依序 concat。成品特性可沿用
 * 已確認的完整原料順序模型；仍未知的是果汁調和器通用售價公式與次級同分規則。
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
