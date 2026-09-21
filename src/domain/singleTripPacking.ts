import {
  BACKPACK_SLOT_CAPACITY,
  CLEAN_CUP_STACK_CAPACITY,
  JUICE_JAR_CAPACITY,
  JUICE_JAR_SLOT_COST,
} from './inventoryRules'
import type { PreparationDemand } from './preparationDemand'

export interface JuiceJarPackingLoad {
  kind: 'juice-jar'
  recipeId: string
  recipeName: string
  servings: number
  slotCost: 1
}

export interface CleanCupPackingLoad {
  kind: 'clean-cups'
  quantity: number
  slotCost: 1
}

export type SingleTripPackingLoad =
  | JuiceJarPackingLoad
  | CleanCupPackingLoad

export interface SingleTripPackingResult {
  capacitySlots: number
  requiredSlots: number
  overflowSlots: number
  fitsInOneTrip: boolean
  /**
   * 完成本次販售趟所需的完整 load。
   * 若 fitsInOneTrip = false，本 slice 不自行挑選要捨棄哪些顧客／配方。
   */
  requiredLoads: SingleTripPackingLoad[]
}

function splitQuantity(quantity: number, capacity: number): number[] {
  const result: number[] = []
  let remaining = Math.max(0, Math.floor(quantity))

  while (remaining > 0) {
    const amount = Math.min(remaining, capacity)
    result.push(amount)
    remaining -= amount
  }

  return result
}

export function buildSingleTripPacking(
  demand: PreparationDemand,
): SingleTripPackingResult {
  const juiceLoads: JuiceJarPackingLoad[] = demand.recipes.flatMap(
    (recipe) =>
      splitQuantity(recipe.assignedServings, JUICE_JAR_CAPACITY).map(
        (servings) => ({
          kind: 'juice-jar' as const,
          recipeId: recipe.recipeId,
          recipeName: recipe.recipeName,
          servings,
          slotCost: JUICE_JAR_SLOT_COST,
        }),
      ),
  )

  const cupLoads: CleanCupPackingLoad[] = splitQuantity(
    demand.cleanCupUses,
    CLEAN_CUP_STACK_CAPACITY,
  ).map((quantity) => ({
    kind: 'clean-cups' as const,
    quantity,
    slotCost: 1,
  }))

  const requiredLoads: SingleTripPackingLoad[] = [
    ...juiceLoads,
    ...cupLoads,
  ]
  const requiredSlots = requiredLoads.reduce(
    (sum, load) => sum + load.slotCost,
    0,
  )
  const overflowSlots = Math.max(
    0,
    requiredSlots - BACKPACK_SLOT_CAPACITY,
  )

  return {
    capacitySlots: BACKPACK_SLOT_CAPACITY,
    requiredSlots,
    overflowSlots,
    fitsInOneTrip: overflowSlots === 0,
    requiredLoads,
  }
}
