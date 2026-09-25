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
 * Candidate-2A 的單一果汁段最多搜尋 4 種不重複原料（1 個 juice-base
 * + 3 個 seasoning），只有所有 unique structure 都無保證完全匹配時，
 * 才啟用單一果汁段的 repeated-seasoning fallback。Candidate-2B 另外以
 * 合法 ordered segment list 搜尋最多 3 個果汁段，並固定由 production path
 * 使用 left-deep Blender tree 執行。這些都是網站搜尋 budget / canonicalization，
 * 不是 simulator/evaluator 或遊戲規則的上限。
 *
 * 手動 simulator 與 SavedRecipe 仍可保留重複調味與更長 sequence；第二個
 * juice-base 代表下一杯飲料的 sequence 開始，整體以果汁調和器串接。
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
  { ingredientId: 'peach', roles: ['juice-base'], baseEquipment: '榨汁機' },
  { ingredientId: 'cucumber', roles: ['juice-base'], baseEquipment: '榨汁機' },
  { ingredientId: 'tomato', roles: ['juice-base'], baseEquipment: '榨汁機' },
  { ingredientId: 'sugar', roles: ['seasoning'] },
  { ingredientId: 'mint', roles: ['seasoning'] },
  { ingredientId: 'cinnamon', roles: ['seasoning'] },
]
