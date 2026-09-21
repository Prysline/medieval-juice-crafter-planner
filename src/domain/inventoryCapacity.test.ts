import { describe, expect, it } from 'vitest'
import type { InventoryState, PlannerSettings } from '../types'
import {
  buildInventoryCapacitySummary,
  selectCarriedJuiceJars,
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
    carriedJuiceJarCount: 0,
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
      settings({ carriedJuiceJarCount: 2 }),
    )

    expect(result).toEqual({
      shelfCount: 2,
      shelfSlotCapacity: 18,
      jarRackCount: 3,
      jarRackStagingCapacity: 15,
      physicalJuiceJarCount: 3,
      physicalCupCount: 11,
      requestedCarriedJuiceJarCount: 2,
      effectiveCarriedJuiceJarCount: 2,
      carriedJuiceJarIds: ['jar-1', 'jar-2'],
      carriedJarSlotCost: 2,
      backpackSlotsRemainingAfterCarriedJars: 8,
      carriedJarRequestExceedsOwned: false,
    })
  })

  it('selects persistent carried jar identities in stable inventory order', () => {
    const state = inventory({
      juiceJars: [
        { id: 'jar-filled', recipeId: 'lemon-juice', servings: 4 },
        { id: 'jar-empty', recipeId: null, servings: 0 },
        { id: 'jar-third', recipeId: 'orange-juice', servings: 2 },
      ],
    })

    expect(
      selectCarriedJuiceJars(
        state,
        settings({ carriedJuiceJarCount: 2 }),
      ),
    ).toEqual([
      { id: 'jar-filled', recipeId: 'lemon-juice', servings: 4 },
      { id: 'jar-empty', recipeId: null, servings: 0 },
    ])
  })

  it('caps carried jars by actual ownership without treating rack slots as jars', () => {
    const result = buildInventoryCapacitySummary(
      inventory({
        jarRackCount: 4,
        juiceJars: [
          { id: 'jar-1', recipeId: null, servings: 0 },
        ],
      }),
      settings({ carriedJuiceJarCount: 5 }),
    )

    expect(result.jarRackStagingCapacity).toBe(20)
    expect(result.physicalJuiceJarCount).toBe(1)
    expect(result.effectiveCarriedJuiceJarCount).toBe(1)
    expect(result.backpackSlotsRemainingAfterCarriedJars).toBe(9)
    expect(result.carriedJarRequestExceedsOwned).toBe(true)
  })
})
