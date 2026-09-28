import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIMIZER_PREFERENCES,
  OPTIMIZER_PREFERENCES_STORAGE_KEY,
  normalizeOptimizerPreferences,
  readOptimizerPreferences,
  writeOptimizerPreferences,
} from './optimizerPreferences'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('optimizer preferences storage', () => {
  it('returns defaults for missing or malformed storage', () => {
    const storage = new MemoryStorage()
    expect(readOptimizerPreferences(storage)).toEqual(
      DEFAULT_OPTIMIZER_PREFERENCES,
    )

    storage.setItem(
      OPTIMIZER_PREFERENCES_STORAGE_KEY,
      '{broken',
    )
    expect(readOptimizerPreferences(storage)).toEqual(
      DEFAULT_OPTIMIZER_PREFERENCES,
    )
  })

  it('round-trips all player-authored optimizer inputs', () => {
    const storage = new MemoryStorage()

    writeOptimizerPreferences(storage, {
      schemaVersion: 1,
      scope: 'formal',
      targetMode: 'customers',
      selectedVillageIds: [
        'tranquil-fountain',
        'ibex-statue',
      ],
      selectedCustomerIds: ['jack', 'nanette'],
      candidatePolicy: 'allow-unambiguous-computed',
      materialSourceMode: 'inventory-only',
      primaryCriterion: 'maximum-known-gross-profit',
      secondaryOne: 'minimum-machine-operations',
      secondaryTwo: 'minimum-jar-fill-operations',
      maxJarFillOperations: 7,
      activeWorkshopRegionId: 'tranquil-fountain',
    })

    expect(readOptimizerPreferences(storage)).toEqual({
      schemaVersion: 1,
      scope: 'formal',
      targetMode: 'customers',
      selectedVillageIds: [
        'tranquil-fountain',
        'ibex-statue',
      ],
      selectedCustomerIds: ['jack', 'nanette'],
      candidatePolicy: 'allow-unambiguous-computed',
      materialSourceMode: 'inventory-only',
      primaryCriterion: 'maximum-known-gross-profit',
      secondaryOne: 'minimum-machine-operations',
      secondaryTwo: 'minimum-jar-fill-operations',
      maxJarFillOperations: 7,
      activeWorkshopRegionId: 'tranquil-fountain',
    })
  })

  it('normalizes unknown enums, invalid ids, duplicate priorities, and invalid limits', () => {
    expect(
      normalizeOptimizerPreferences({
        schemaVersion: 99,
        scope: 'mystery',
        targetMode: 'future-mode',
        selectedVillageIds: [
          'tranquil-fountain',
          'missing-region',
          'tranquil-fountain',
        ],
        selectedCustomerIds: [
          'jack',
          'future-customer',
          'jack',
        ],
        candidatePolicy: 'observed-only',
        materialSourceMode: 'future-mode',
        primaryCriterion: 'minimum-cost',
        secondaryOne: 'minimum-cost',
        secondaryTwo: 'minimum-waste',
        maxJarFillOperations: -4,
        activeWorkshopRegionId: 'missing-region',
      }),
    ).toEqual({
      schemaVersion: 1,
      scope: 'all',
      targetMode: 'all',
      selectedVillageIds: ['tranquil-fountain'],
      selectedCustomerIds: ['jack'],
      candidatePolicy: 'trusted-only',
      materialSourceMode: 'normal',
      primaryCriterion: 'minimum-cost',
      secondaryOne: 'none',
      secondaryTwo: 'minimum-waste',
      maxJarFillOperations: null,
      activeWorkshopRegionId: 'east-harbor',
    })
  })

  it('floors a finite non-negative fill-operation limit and defaults missing fields independently', () => {
    expect(
      normalizeOptimizerPreferences({
        candidatePolicy: 'allow-unambiguous-computed',
        maxJarFillOperations: 4.9,
      }),
    ).toEqual({
      ...DEFAULT_OPTIMIZER_PREFERENCES,
      candidatePolicy: 'allow-unambiguous-computed',
      maxJarFillOperations: 4,
    })
  })
})
