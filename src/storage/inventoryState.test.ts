import { describe, expect, it } from 'vitest'
import {
  EMPTY_INVENTORY_STATE,
  INVENTORY_STORAGE_KEY,
  normalizeInventoryState,
  readInventoryState,
  resizeJuiceJarInventory,
  writeInventoryState,
} from './inventoryState'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('inventory storage', () => {
  it('returns an empty inventory for missing or invalid storage', () => {
    const storage = new MemoryStorage()
    expect(readInventoryState(storage)).toEqual(EMPTY_INVENTORY_STATE)

    storage.setItem(INVENTORY_STORAGE_KEY, '{broken')
    expect(readInventoryState(storage)).toEqual(EMPTY_INVENTORY_STATE)
  })

  it('normalizes counts and preserves schema-valid stale ingredient ids', () => {
    expect(
      normalizeInventoryState({
        ingredientUnits: {
          lemon: 3.9,
          'future-ingredient': 2,
          negative: -4,
          broken: 'x',
        },
        waterUnits: 12.8,
        cleanCups: 4,
        usedCups: -1,
        juiceJars: [],
        shelfCount: 2.8,
        jarRackCount: -1,
      }),
    ).toEqual({
      ingredientUnits: {
        lemon: 3,
        'future-ingredient': 2,
      },
      waterUnits: 12,
      cleanCups: 4,
      usedCups: 0,
      juiceJars: [],
      shelfCount: 2,
      jarRackCount: 0,
    })
  })

  it('enforces jar capacity and one recipe identity per non-empty jar', () => {
    expect(
      normalizeInventoryState({
        ingredientUnits: {},
        waterUnits: 0,
        cleanCups: 0,
        usedCups: 0,
        shelfCount: 0,
        jarRackCount: 0,
        juiceJars: [
          { id: 'empty', recipeId: 'stale', servings: 0 },
          { id: 'lemon', recipeId: 'lemon-juice', servings: 10 },
          { id: 'over', recipeId: 'orange-juice', servings: 11 },
          { id: 'missing-recipe', servings: 2 },
        ],
      }).juiceJars,
    ).toEqual([
      { id: 'empty', recipeId: null, servings: 0 },
      { id: 'lemon', recipeId: 'lemon-juice', servings: 10 },
    ])
  })

  it('deduplicates jar ids and round-trips normalized state', () => {
    const storage = new MemoryStorage()
    writeInventoryState(storage, {
      ingredientUnits: { lemon: 2 },
      waterUnits: 5,
      cleanCups: 3,
      usedCups: 1,
      shelfCount: 2,
      jarRackCount: 1,
      juiceJars: [
        { id: 'jar-1', recipeId: 'lemon-juice', servings: 4 },
        { id: 'jar-1', recipeId: 'orange-juice', servings: 2 },
      ],
    })

    expect(readInventoryState(storage)).toEqual({
      ingredientUnits: { lemon: 2 },
      waterUnits: 5,
      cleanCups: 3,
      usedCups: 1,
      shelfCount: 2,
      jarRackCount: 1,
      juiceJars: [
        { id: 'jar-1', recipeId: 'lemon-juice', servings: 4 },
      ],
    })
  })

  it('resizes physical jar inventory without discarding filled jars', () => {
    const base = normalizeInventoryState({
      ingredientUnits: {},
      waterUnits: 0,
      cleanCups: 0,
      usedCups: 0,
      shelfCount: 0,
      jarRackCount: 1,
      juiceJars: [
        { id: 'filled', recipeId: 'lemon-juice', servings: 4 },
        { id: 'empty-a', recipeId: null, servings: 0 },
      ],
    })

    const expanded = resizeJuiceJarInventory(base, 4)
    expect(expanded.juiceJars).toHaveLength(4)
    expect(expanded.juiceJars[0]).toEqual({
      id: 'filled',
      recipeId: 'lemon-juice',
      servings: 4,
    })

    const reduced = resizeJuiceJarInventory(expanded, 0)
    expect(reduced.juiceJars).toEqual([
      { id: 'filled', recipeId: 'lemon-juice', servings: 4 },
    ])
  })
})
