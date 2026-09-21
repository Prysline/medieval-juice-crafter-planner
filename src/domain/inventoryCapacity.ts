import {
  BACKPACK_SLOT_CAPACITY,
  GENERAL_SHELF_SLOT_CAPACITY,
  JUICE_JAR_RACK_SLOT_CAPACITY,
  JUICE_JAR_SLOT_COST,
} from './inventoryRules'
import type { InventoryState, PlannerSettings } from '../types'

export interface InventoryCapacitySummary {
  shelfCount: number
  shelfSlotCapacity: number
  jarRackCount: number
  jarRackStagingCapacity: number
  physicalJuiceJarCount: number
  physicalCupCount: number
  requestedCarriedJuiceJarCount: number
  effectiveCarriedJuiceJarCount: number
  carriedJarSlotCost: number
  backpackSlotsRemainingAfterCarriedJars: number
  carriedJarRequestExceedsOwned: boolean
}

export function buildInventoryCapacitySummary(
  inventory: InventoryState,
  settings: PlannerSettings,
): InventoryCapacitySummary {
  const physicalJuiceJarCount = inventory.juiceJars.length
  const requestedCarriedJuiceJarCount = Math.max(
    0,
    Math.floor(settings.carriedJuiceJarCount),
  )
  const effectiveCarriedJuiceJarCount = Math.min(
    requestedCarriedJuiceJarCount,
    physicalJuiceJarCount,
    BACKPACK_SLOT_CAPACITY,
  )
  const carriedJarSlotCost =
    effectiveCarriedJuiceJarCount * JUICE_JAR_SLOT_COST

  return {
    shelfCount: inventory.shelfCount,
    shelfSlotCapacity:
      inventory.shelfCount * GENERAL_SHELF_SLOT_CAPACITY,
    jarRackCount: inventory.jarRackCount,
    jarRackStagingCapacity:
      inventory.jarRackCount * JUICE_JAR_RACK_SLOT_CAPACITY,
    physicalJuiceJarCount,
    physicalCupCount: inventory.cleanCups + inventory.usedCups,
    requestedCarriedJuiceJarCount,
    effectiveCarriedJuiceJarCount,
    carriedJarSlotCost,
    backpackSlotsRemainingAfterCarriedJars:
      BACKPACK_SLOT_CAPACITY - carriedJarSlotCost,
    carriedJarRequestExceedsOwned:
      requestedCarriedJuiceJarCount > physicalJuiceJarCount,
  }
}
