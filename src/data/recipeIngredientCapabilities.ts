import type { Ingredient } from '../types'

export type RecipeIngredientRole = 'juice-base' | 'seasoning'

export interface RecipeIngredientCapability {
  ingredientId: Ingredient['id']
  roles: RecipeIngredientRole[]
  /** 作為果汁基底時所需的第一段榨汁設備。 */
  baseEquipment?: '柑橘榨汁機' | '榨汁機'
}

/**
 * PR 2B 第一版只處理「一種果汁基底 + 0～2 種不重複調味材料」。
 *
 * - 檸檬／橙子：既有柑橘榨汁機配方直接確認。
 * - 紅蘿蔔／梨：既有榨汁機配方直接確認。
 * - 香蕉：權威資料已確認榨汁機可處理。
 * - 糖／薄荷：既有調味配方直接確認。
 * - 肉桂：遊戲分類為香料，而調味器已確認接受香料類調味材料。
 *
 * 果汁調和器的「兩種果汁」規則尚未確認，因此不把兩個 juice-base
 * 自動組成同一候選配方。
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
