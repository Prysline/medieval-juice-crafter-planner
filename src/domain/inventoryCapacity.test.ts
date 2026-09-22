import { describe, expect, it } from 'vitest'
import type { InventoryState, PlannerSettings } from '../types'
import {
  buildInventoryCapacitySummary,
  selectAccessibleJuiceJars,
} from './inventoryCapacity'

function inventory(
  patch: Partial<InventoryState> = {},
): InventoryState {
  return {
    ingredientUnits: {},
    waterUnits: 0,
    cleanCups: 0,
    usedCups: 0,
    juiceJars: [],
    shelfCount: 0,
    jarRackCount: 0,
    ...patch,
  }
}

function settings(
  patch: Partial<PlannerSettings> = {},
): PlannerSettings {
  return {
    juiceJarCarryMode: 'auto',
    reservedJuiceJarSlots: 0,
    allowUsedCupDropIfFull: false,
    ...patch,
  }
}

describe('inventory capacity summary', () => {
  it('keeps shelf, jar rack, physical jars and cups as separate capacities', () => {
    const result = buildInventoryCapacitySummary(
      inventory({
        shelfCount: 2,
        jarRackCount: 3,
        cleanCups: 7,
        usedCups: 4,
        juiceJars: [
          { id: 'jar-1', recipeId: null, servings: 0 },
          { id: 'jar-2', recipeId: 'lemon', servings: 3 },
          { id: 'jar-3', recipeId: null, servings: 0 },
        ],
      }),
      settings({
        juiceJarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: 2,
      }),
    )

    expect(result).toEqual({
      shelfCount: 2,
      shelfSlotCapacity: 18,
      jarRackCount: 3,
      jarRackStagingCapacity: 15,
      physicalJuiceJarCount: 3,
      physicalCupCount: 11,
      juiceJarCarryMode: 'fixed-slots',
      requestedReservedJuiceJarSlots: 2,
      minimumCarriedJuiceJarSlots: 0,
      effectiveReservedJuiceJarSlots: 2,
      maxJuiceJarSlotsPerTrip: 2,
      carriedJarSlotCost: 2,
      backpackSlotsRemainingAfterCarriedJars: 8,
      allOwnedJarsMustBeCarried: false,
      jarStorageCapacityExceeded: false,
    })
  })

  it('makes every owned jar mandatory when there is no jar rack', () => {
    const result = buildInventoryCapacitySummary(
      inventory({
        juiceJars: [
          { id: 'jar-1', recipeId: null, servings: 0 },
          { id: 'jar-2', recipeId: 'lemon', servings: 3 },
          { id: 'jar-3', recipeId: null, servings: 0 },
        ],
      }),
      settings(),
    )

    expect(result.minimumCarriedJuiceJarSlots).toBe(3)
    expect(result.effectiveReservedJuiceJarSlots).toBe(3)
    expect(result.maxJuiceJarSlotsPerTrip).toBe(3)
    expect(result.allOwnedJarsMustBeCarried).toBe(true)
    expect(result.backpackSlotsRemainingAfterCarriedJars).toBe(7)
  })

  it('auto mode only forces jars that cannot fit on the rack', () => {
    const result = buildInventoryCapacitySummary(
      inventory({
        jarRackCount: 1,
        juiceJars: Array.from({ length: 7 }, (_, index) => ({
          id: `jar-${index + 1}`,
          recipeId: null,
          servings: 0,
        })),
      }),
      settings(),
    )

    expect(result.jarRackStagingCapacity).toBe(5)
    expect(result.minimumCarriedJuiceJarSlots).toBe(2)
    expect(result.effectiveReservedJuiceJarSlots).toBe(2)
    expect(result.maxJuiceJarSlotsPerTrip).toBe(7)
  })

  it('fixed slots preserve the requested backpack reservation without binding jar identities', () => {
    const result = buildInventoryCapacitySummary(
      inventory({
        jarRackCount: 1,
        juiceJars: [
          { id: 'jar-filled', recipeId: 'lemon', servings: 4 },
          { id: 'jar-empty', recipeId: null, servings: 0 },
        ],
      }),
      settings({
        juiceJarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: 4,
      }),
    )

    expect(result.effectiveReservedJuiceJarSlots).toBe(2)
    expect(result.maxJuiceJarSlotsPerTrip).toBe(2)
    expect(result.backpackSlotsRemainingAfterCarriedJars).toBe(8)
    expect(selectAccessibleJuiceJars(inventory({
      juiceJars: [
        { id: 'jar-filled', recipeId: 'lemon', servings: 4 },
        { id: 'jar-empty', recipeId: null, servings: 0 },
      ],
    }))).toEqual([
      { id: 'jar-filled', recipeId: 'lemon', servings: 4 },
      { id: 'jar-empty', recipeId: null, servings: 0 },
    ])
  })

  it('flags impossible ownership when rack plus backpack cannot hold every jar', () => {
    const result = buildInventoryCapacitySummary(
      inventory({
        jarRackCount: 1,
        juiceJars: Array.from({ length: 16 }, (_, index) => ({
          id: `jar-${index + 1}`,
          recipeId: null,
          servings: 0,
        })),
      }),
      settings(),
    )

    expect(result.minimumCarriedJuiceJarSlots).toBe(11)
    expect(result.jarStorageCapacityExceeded).toBe(true)
  })
})
