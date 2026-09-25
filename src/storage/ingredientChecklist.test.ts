import { describe, expect, it } from 'vitest'
import {
  ingredientChecklistFingerprint,
  readIngredientChecklist,
  writeIngredientChecklist,
} from './ingredientChecklist'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

const items = [
  {
    ingredientId: 'lemon',
    requiredUnits: 5,
    inventoryUnitsUsed: 2,
    purchaseUnits: 3,
  },
  {
    ingredientId: 'sugar',
    requiredUnits: 2,
    inventoryUnitsUsed: 0,
    purchaseUnits: 2,
  },
]

describe('ingredient checklist', () => {
  it('persists checked ingredients for the same material requirement', () => {
    const storage = memoryStorage()
    writeIngredientChecklist(storage, items, ['lemon'])

    expect(readIngredientChecklist(storage, items)).toEqual(['lemon'])
  })

  it('resets when the material requirement changes', () => {
    const storage = memoryStorage()
    writeIngredientChecklist(storage, items, ['lemon'])

    expect(
      readIngredientChecklist(storage, [
        { ...items[0], purchaseUnits: 4 },
        items[1],
      ]),
    ).toEqual([])
  })

  it('ignores unknown ingredient ids', () => {
    const storage = memoryStorage()
    writeIngredientChecklist(storage, items, ['lemon', 'unknown'])

    expect(readIngredientChecklist(storage, items)).toEqual(['lemon'])
  })

  it('fingerprints quantities as well as ingredient identity', () => {
    expect(ingredientChecklistFingerprint(items)).not.toBe(
      ingredientChecklistFingerprint([
        { ...items[0], requiredUnits: 6 },
        items[1],
      ]),
    )
  })
})
