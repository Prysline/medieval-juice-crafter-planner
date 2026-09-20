import { describe, expect, it } from 'vitest'
import type { SavedRecipe } from '../types'
import {
  readSavedRecipes,
  removeSavedRecipe,
  SAVED_RECIPES_STORAGE_KEY,
  upsertSavedRecipe,
  writeSavedRecipes,
} from './savedRecipes'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const saved: SavedRecipe = {
  id: 'saved-1',
  name: '常用橙糖薄荷',
  ingredientIds: ['orange', 'sugar', 'mint'],
  note: '先糖後薄荷',
  createdAt: '2026-09-21T00:00:00.000Z',
}

describe('saved recipe storage', () => {
  it('round-trips ingredient order without storing derived recipe data', () => {
    const storage = new MemoryStorage()
    writeSavedRecipes(storage, [saved])

    expect(readSavedRecipes(storage)).toEqual([saved])

    const raw = storage.getItem(SAVED_RECIPES_STORAGE_KEY) ?? ''
    expect(raw).not.toContain('effects')
    expect(raw).not.toContain('batchIngredientCost')
    expect(raw).not.toContain('equipment')
  })

  it('drops malformed rows but preserves schema-valid stale ingredient ids', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      SAVED_RECIPES_STORAGE_KEY,
      JSON.stringify([
        saved,
        {
          id: 'future',
          name: '未來舊資料',
          ingredientIds: ['unknown-future-ingredient'],
          createdAt: '2026-09-21T00:00:00.000Z',
        },
        { id: 42, name: 'broken' },
      ]),
    )

    expect(readSavedRecipes(storage)).toHaveLength(2)
    expect(readSavedRecipes(storage)[1].ingredientIds).toEqual([
      'unknown-future-ingredient',
    ])
  })

  it('upserts metadata without changing sequence order', () => {
    const updated = upsertSavedRecipe([saved], {
      ...saved,
      name: '改名',
      note: '新備註',
    })

    expect(updated).toEqual([
      {
        ...saved,
        name: '改名',
        note: '新備註',
      },
    ])
    expect(updated[0].ingredientIds).toEqual([
      'orange',
      'sugar',
      'mint',
    ])
  })

  it('removes a saved recipe without touching other entries', () => {
    const other: SavedRecipe = {
      ...saved,
      id: 'saved-2',
      name: '另一個',
    }

    expect(removeSavedRecipe([saved, other], saved.id)).toEqual([other])
  })
})
