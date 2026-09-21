import { describe, expect, it } from 'vitest'
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

describe('planner settings storage', () => {
  it('defaults to zero carried jars and drop opt-in disabled', () => {
    const storage = new MemoryStorage()
    expect(readPlannerSettings(storage)).toEqual(
      DEFAULT_PLANNER_SETTINGS,
    )

    storage.setItem(PLANNER_SETTINGS_STORAGE_KEY, '{broken')
    expect(readPlannerSettings(storage)).toEqual(
      DEFAULT_PLANNER_SETTINGS,
    )
  })

  it('normalizes counts and only enables drop policy explicitly', () => {
    expect(
      normalizePlannerSettings({
        carriedJuiceJarCount: 3.8,
        allowUsedCupDropIfFull: true,
      }),
    ).toEqual({
      carriedJuiceJarCount: 3,
      allowUsedCupDropIfFull: true,
    })

    expect(
      normalizePlannerSettings({
        carriedJuiceJarCount: -4,
        allowUsedCupDropIfFull: 'yes',
      }),
    ).toEqual(DEFAULT_PLANNER_SETTINGS)
  })

  it('round-trips normalized settings', () => {
    const storage = new MemoryStorage()
    writePlannerSettings(storage, {
      carriedJuiceJarCount: 2.9,
      allowUsedCupDropIfFull: true,
    })

    expect(readPlannerSettings(storage)).toEqual({
      carriedJuiceJarCount: 2,
      allowUsedCupDropIfFull: true,
    })
  })
})
