import { describe, expect, it } from 'vitest'
import {
  readCurrentProgress,
  readSatisfactionByVillage,
  STORAGE_KEYS,
  writeCurrentProgress,
} from './plannerState'

class MemoryStorage {
  private values = new Map<string, string>()

  constructor(initial: Record<string, string> = {}) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, value))
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

describe('planner state migration', () => {
  it.each([
    ['1', 'opening'],
    ['2', 'seasoner-unlocked'],
    ['3', 'juice-jar-unlocked'],
    ['4', 'juicer-unlocked'],
  ])('migrates legacy stage %s conservatively', (legacyStage, expected) => {
    const storage = new MemoryStorage({
      [STORAGE_KEYS.legacyStage]: legacyStage,
    })

    expect(readCurrentProgress(storage)).toBe(expected)
    expect(storage.getItem(STORAGE_KEYS.progress)).toBe(expected)
  })

  it('never guesses tranquil fountain from legacy stage 4', () => {
    const storage = new MemoryStorage({
      [STORAGE_KEYS.legacyStage]: '4',
    })

    expect(readCurrentProgress(storage)).toBe('juicer-unlocked')
    expect(readCurrentProgress(storage)).not.toBe('tranquil-fountain-unlocked')
  })

  it('does not treat an unreleased legacy stage 5 as juice blender progress', () => {
    const storage = new MemoryStorage({
      [STORAGE_KEYS.legacyStage]: '5',
    })

    expect(readCurrentProgress(storage)).toBe('seasoner-unlocked')
    expect(readCurrentProgress(storage)).not.toBe('juice-blender-unlocked')
  })

  it('prefers the new progress key after migration', () => {
    const storage = new MemoryStorage({
      [STORAGE_KEYS.progress]: 'tranquil-fountain-unlocked',
      [STORAGE_KEYS.legacyStage]: '1',
    })

    expect(readCurrentProgress(storage)).toBe('tranquil-fountain-unlocked')
  })

  it('keeps later new progress even when a legacy stage remains', () => {
    const storage = new MemoryStorage({
      [STORAGE_KEYS.legacyStage]: '4',
    })

    expect(readCurrentProgress(storage)).toBe('juicer-unlocked')
    writeCurrentProgress(storage, 'juice-blender-unlocked')
    expect(readCurrentProgress(storage)).toBe('juice-blender-unlocked')
  })

  it('migrates legacy satisfaction to east harbor only', () => {
    const storage = new MemoryStorage({
      [STORAGE_KEYS.legacySatisfaction]: '250',
    })

    expect(readSatisfactionByVillage(storage)).toEqual({
      'east-harbor': 250,
      'tranquil-fountain': 0,
    })
  })

  it('does not overwrite the new satisfaction object with a legacy value', () => {
    const storage = new MemoryStorage({
      [STORAGE_KEYS.satisfactionByVillage]: JSON.stringify({
        'east-harbor': 12,
        'tranquil-fountain': 345,
      }),
      [STORAGE_KEYS.legacySatisfaction]: '999',
    })

    expect(readSatisfactionByVillage(storage)).toEqual({
      'east-harbor': 12,
      'tranquil-fountain': 345,
    })
  })

  it('does not touch the supplied-today key during migration', () => {
    const supplied = JSON.stringify(['jack', 'nanette'])
    const storage = new MemoryStorage({
      [STORAGE_KEYS.legacyStage]: '4',
      [STORAGE_KEYS.legacySatisfaction]: '250',
      [STORAGE_KEYS.suppliedToday]: supplied,
    })

    readCurrentProgress(storage)
    readSatisfactionByVillage(storage)

    expect(storage.getItem(STORAGE_KEYS.suppliedToday)).toBe(supplied)
  })
})
