import { describe, expect, it } from 'vitest'
import type { InventoryState } from '../types'
import {
  DEFAULT_PLANNER_SETTINGS,
  PLANNER_SETTINGS_STORAGE_KEY,
  normalizePlannerSettings,
  readPlannerSettings,
  writePlannerSettings,
} from './plannerSettings'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

function inventory(ids: string[]): InventoryState {
  return {
    ingredientUnits: {},
    waterUnits: 0,
    cleanCups: 0,
    usedCups: 0,
    juiceJars: ids.map((id) => ({
      id,
      recipeId: null,
      servings: 0,
    })),
    shelfCount: 0,
    jarRackCount: 0,
  }
}

describe('planner settings storage', () => {
  it('defaults to automatic jar carry planning and drop opt-in disabled', () => {
    const storage = new MemoryStorage()
    expect(readPlannerSettings(storage)).toEqual(
      DEFAULT_PLANNER_SETTINGS,
    )

    storage.setItem(PLANNER_SETTINGS_STORAGE_KEY, '{broken')
    expect(readPlannerSettings(storage)).toEqual(
      DEFAULT_PLANNER_SETTINGS,
    )
  })

  it('normalizes canonical carry mode, reserved slots and drop policy', () => {
    expect(
      normalizePlannerSettings({
        juiceJarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: 12.9,
        allowUsedCupDropIfFull: true,
      }),
    ).toEqual({
      juiceJarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 10,
      allowUsedCupDropIfFull: true,
    })

    expect(
      normalizePlannerSettings({
        juiceJarCarryMode: 'auto',
        reservedJuiceJarSlots: 7,
        allowUsedCupDropIfFull: false,
      }),
    ).toEqual({
      juiceJarCarryMode: 'auto',
      reservedJuiceJarSlots: 7,
      allowUsedCupDropIfFull: false,
    })
  })

  it('migrates legacy carried jar IDs to a fixed slot count without retaining identities', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      PLANNER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        carriedJuiceJarIds: [
          'owned-b',
          'owned-b',
          'missing',
          'owned-a',
        ],
        allowUsedCupDropIfFull: true,
      }),
    )

    expect(
      readPlannerSettings(
        storage,
        inventory(['owned-a', 'owned-b', 'owned-c']),
      ),
    ).toEqual({
      juiceJarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 2,
      allowUsedCupDropIfFull: true,
    })

    expect(
      JSON.parse(
        storage.getItem(PLANNER_SETTINGS_STORAGE_KEY) ?? '{}',
      ),
    ).toEqual({
      juiceJarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 2,
      allowUsedCupDropIfFull: true,
    })
  })

  it('migrates the older carried count using current ownership as the effective legacy count', () => {
    expect(
      normalizePlannerSettings(
        {
          carriedJuiceJarCount: 5,
          allowUsedCupDropIfFull: false,
        },
        inventory(['owned-a', 'owned-b', 'owned-c']),
      ),
    ).toEqual({
      juiceJarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 3,
      allowUsedCupDropIfFull: false,
    })
  })

  it('round-trips canonical slot settings', () => {
    const storage = new MemoryStorage()
    writePlannerSettings(storage, {
      juiceJarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 4,
      allowUsedCupDropIfFull: true,
    })

    expect(readPlannerSettings(storage)).toEqual({
      juiceJarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 4,
      allowUsedCupDropIfFull: true,
    })
  })
})
