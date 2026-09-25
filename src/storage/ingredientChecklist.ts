export const INGREDIENT_CHECKLIST_STORAGE_KEY =
  'mjc-ingredient-checklist'

export const INGREDIENT_CHECKLIST_SCHEMA =
  'ingredient-checklist-v1' as const

interface StorageReadWrite {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface IngredientChecklistItem {
  ingredientId: string
  requiredUnits: number
  inventoryUnitsUsed: number
  purchaseUnits: number
}

export function ingredientChecklistFingerprint(
  items: readonly IngredientChecklistItem[],
): string {
  return JSON.stringify({
    schemaVersion: INGREDIENT_CHECKLIST_SCHEMA,
    items: items.map((item) => ({
      ingredientId: item.ingredientId,
      requiredUnits: item.requiredUnits,
      inventoryUnitsUsed: item.inventoryUnitsUsed,
      purchaseUnits: item.purchaseUnits,
    })),
  })
}

export function readIngredientChecklist(
  storage: Pick<StorageReadWrite, 'getItem'>,
  items: readonly IngredientChecklistItem[],
): string[] {
  const fingerprint = ingredientChecklistFingerprint(items)
  const validIds = new Set(items.map((item) => item.ingredientId))
  const raw = storage.getItem(INGREDIENT_CHECKLIST_STORAGE_KEY)
  if (raw === null) return []

  try {
    const parsed = JSON.parse(raw) as {
      schemaVersion?: unknown
      fingerprint?: unknown
      checkedIngredientIds?: unknown
    }
    if (
      parsed.schemaVersion !== INGREDIENT_CHECKLIST_SCHEMA ||
      parsed.fingerprint !== fingerprint ||
      !Array.isArray(parsed.checkedIngredientIds)
    ) {
      return []
    }
    return [
      ...new Set(
        parsed.checkedIngredientIds.filter(
          (value): value is string =>
            typeof value === 'string' && validIds.has(value),
        ),
      ),
    ]
  } catch {
    return []
  }
}

export function writeIngredientChecklist(
  storage: Pick<StorageReadWrite, 'setItem'>,
  items: readonly IngredientChecklistItem[],
  checkedIngredientIds: Iterable<string>,
): string[] {
  const validIds = new Set(items.map((item) => item.ingredientId))
  const normalized = [
    ...new Set(
      [...checkedIngredientIds].filter((id) => validIds.has(id)),
    ),
  ]
  storage.setItem(
    INGREDIENT_CHECKLIST_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: INGREDIENT_CHECKLIST_SCHEMA,
      fingerprint: ingredientChecklistFingerprint(items),
      checkedIngredientIds: normalized,
    }),
  )
  return normalized
}
