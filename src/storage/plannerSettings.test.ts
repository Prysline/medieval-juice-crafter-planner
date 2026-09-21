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
  it('defaults to no carried jars and drop opt-in disabled', () => {
    const storage = new MemoryStorage()
    expect(readPlannerSettings(storage)).toEqual(
      DEFAULT_PLANNER_SETTINGS,
    )

    storage.setItem(PLANNER_SETTINGS_STORAGE_KEY, '{broken')
    expect(readPlannerSettings(storage)).toEqual(
      DEFAULT_PLANNER_SETTINGS,
    )
  })

  it('normalizes unique persistent jar IDs and explicit drop policy', () => {
    expect(
      normalizePlannerSettings({
        carriedJuiceJarIds: [
          ' jar-2 ',
          'jar-2',
          '',
          3,
          'jar-1',
        ],
        allowUsedCupDropIfFull: true,
      }),
    ).toEqual({
      carriedJuiceJarIds: ['jar-2', 'jar-1'],
      allowUsedCupDropIfFull: true,
    })

    expect(
      normalizePlannerSettings({
        carriedJuiceJarIds: 'jar-1',
        allowUsedCupDropIfFull: 'yes',
      }),
    ).toEqual(DEFAULT_PLANNER_SETTINGS)
  })

  it('migrates legacy carried count using stable inventory order', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      PLANNER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        carriedJuiceJarCount: 2.9,
        allowUsedCupDropIfFull: true,
      }),
    )

    expect(
      readPlannerSettings(
        storage,
        inventory(['owned-a', 'owned-b', 'owned-c']),
      ),
    ).toEqual({
      carriedJuiceJarIds: ['owned-a', 'owned-b'],
      allowUsedCupDropIfFull: true,
    })
  })

  it('round-trips canonical ID settings', () => {
    const storage = new MemoryStorage()
    writePlannerSettings(storage, {
      carriedJuiceJarIds: ['jar-2', 'jar-1', 'jar-2'],
      allowUsedCupDropIfFull: true,
    })

    expect(readPlannerSettings(storage)).toEqual({
      carriedJuiceJarIds: ['jar-2', 'jar-1'],
      allowUsedCupDropIfFull: true,
    })
  })
})
