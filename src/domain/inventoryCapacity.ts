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
  juiceJarCarryMode: PlannerSettings['juiceJarCarryMode']
  requestedReservedJuiceJarSlots: number
  minimumCarriedJuiceJarSlots: number
  effectiveReservedJuiceJarSlots: number
  maxJuiceJarSlotsPerTrip: number
  carriedJarSlotCost: number
  backpackSlotsRemainingAfterCarriedJars: number
  allOwnedJarsMustBeCarried: boolean
  jarStorageCapacityExceeded: boolean
}

export function selectAccessibleJuiceJars(
  inventory: InventoryState,
): JuiceJarInventoryItem[] {
  return inventory.juiceJars.map((jar) => ({ ...jar }))
}

export function buildInventoryCapacitySummary(
  inventory: InventoryState,
  settings: PlannerSettings,
): InventoryCapacitySummary {
  const physicalJuiceJarCount = inventory.juiceJars.length
  const jarRackStagingCapacity =
    inventory.jarRackCount * JUICE_JAR_RACK_SLOT_CAPACITY
  const minimumCarriedJuiceJarSlots = Math.max(
    0,
    physicalJuiceJarCount - jarRackStagingCapacity,
  )
  const requestedReservedJuiceJarSlots =
    settings.juiceJarCarryMode === 'fixed-slots'
      ? Math.min(
          BACKPACK_SLOT_CAPACITY,
          Math.max(0, Math.floor(settings.reservedJuiceJarSlots)),
        )
      : 0
  const effectiveReservedJuiceJarSlots =
    settings.juiceJarCarryMode === 'fixed-slots'
      ? Math.min(
          physicalJuiceJarCount,
          Math.max(
            minimumCarriedJuiceJarSlots,
            requestedReservedJuiceJarSlots,
          ),
        )
      : minimumCarriedJuiceJarSlots
  const maxJuiceJarSlotsPerTrip =
    settings.juiceJarCarryMode === 'fixed-slots'
      ? Math.min(
          physicalJuiceJarCount,
          effectiveReservedJuiceJarSlots,
        )
      : Math.min(
          physicalJuiceJarCount,
          BACKPACK_SLOT_CAPACITY,
        )
  const carriedJarSlotCost =
    effectiveReservedJuiceJarSlots * JUICE_JAR_SLOT_COST

  return {
    shelfCount: inventory.shelfCount,
    shelfSlotCapacity:
      inventory.shelfCount * GENERAL_SHELF_SLOT_CAPACITY,
    jarRackCount: inventory.jarRackCount,
    jarRackStagingCapacity,
    physicalJuiceJarCount,
    physicalCupCount: inventory.cleanCups + inventory.usedCups,
    juiceJarCarryMode: settings.juiceJarCarryMode,
    requestedReservedJuiceJarSlots,
    minimumCarriedJuiceJarSlots,
    effectiveReservedJuiceJarSlots,
    maxJuiceJarSlotsPerTrip,
    carriedJarSlotCost,
    backpackSlotsRemainingAfterCarriedJars:
      BACKPACK_SLOT_CAPACITY - carriedJarSlotCost,
    allOwnedJarsMustBeCarried:
      inventory.jarRackCount === 0 && physicalJuiceJarCount > 0,
    jarStorageCapacityExceeded:
      minimumCarriedJuiceJarSlots > BACKPACK_SLOT_CAPACITY,
  }
}
