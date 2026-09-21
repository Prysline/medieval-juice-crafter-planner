import {
  BACKPACK_SLOT_CAPACITY,
  GENERAL_SHELF_SLOT_CAPACITY,
  JUICE_JAR_RACK_SLOT_CAPACITY,
  JUICE_JAR_SLOT_COST,
} from './inventoryRules'
import type {
  InventoryState,
  JuiceJarInventoryItem,
  PlannerSettings,
} from '../types'

export interface InventoryCapacitySummary {
  shelfCount: number
  shelfSlotCapacity: number
  jarRackCount: number
  jarRackStagingCapacity: number
  physicalJuiceJarCount: number
  physicalCupCount: number
  requestedCarriedJuiceJarCount: number
  effectiveCarriedJuiceJarCount: number
  carriedJuiceJarIds: string[]
  carriedJarSlotCost: number
  backpackSlotsRemainingAfterCarriedJars: number
  carriedJarRequestExceedsOwned: boolean
}

export function selectCarriedJuiceJars(
  inventory: InventoryState,
  settings: PlannerSettings,
): JuiceJarInventoryItem[] {
  const requestedCarriedJuiceJarCount = Math.max(
    0,
    Math.floor(settings.carriedJuiceJarCount),
  )
  const effectiveCarriedJuiceJarCount = Math.min(
    requestedCarriedJuiceJarCount,
    inventory.juiceJars.length,
    BACKPACK_SLOT_CAPACITY,
  )

  return inventory.juiceJars
    .slice(0, effectiveCarriedJuiceJarCount)
    .map((jar) => ({ ...jar }))
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
  const carriedJuiceJars = selectCarriedJuiceJars(
    inventory,
    settings,
  )
  const effectiveCarriedJuiceJarCount =
    carriedJuiceJars.length
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
    carriedJuiceJarIds: carriedJuiceJars.map((jar) => jar.id),
    carriedJarSlotCost,
    backpackSlotsRemainingAfterCarriedJars:
      BACKPACK_SLOT_CAPACITY - carriedJarSlotCost,
    carriedJarRequestExceedsOwned:
      requestedCarriedJuiceJarCount > physicalJuiceJarCount,
  }
}
