import { JUICE_JAR_CAPACITY } from '../domain/inventoryRules'
import type {
  InventoryState,
  JuiceJarInventoryItem,
} from '../types'
import type { StorageLike } from './plannerState'

export const INVENTORY_STORAGE_KEY = 'mjc-inventory'

function createEmptyInventoryState(): InventoryState {
  return {
    ingredientUnits: {},
    waterUnits: 0,
    cleanCups: 0,
    usedCups: 0,
    juiceJars: [],
  }
}

export const EMPTY_INVENTORY_STATE: InventoryState =
  createEmptyInventoryState()

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

function normalizeIngredientUnits(
  value: unknown,
): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([id]) => id.length > 0)
      .map(
        ([id, quantity]) =>
          [id, normalizeCount(quantity)] as const,
      )
      .filter(([, quantity]) => quantity > 0),
  )
}

function normalizeJar(value: unknown): JuiceJarInventoryItem | null {
  if (!value || typeof value !== 'object') return null

  const jar = value as Partial<JuiceJarInventoryItem>
  if (typeof jar.id !== 'string' || jar.id.length === 0) return null

  if (
    typeof jar.servings !== 'number' ||
    !Number.isFinite(jar.servings) ||
    jar.servings < 0
  ) {
    return null
  }

  const servings = Math.floor(jar.servings)
  if (servings > JUICE_JAR_CAPACITY) return null

  if (servings === 0) {
    return {
      id: jar.id,
      recipeId: null,
      servings: 0,
    }
  }

  if (typeof jar.recipeId !== 'string' || jar.recipeId.length === 0) {
    return null
  }

  return {
    id: jar.id,
    recipeId: jar.recipeId,
    servings,
  }
}

function normalizeJars(value: unknown): JuiceJarInventoryItem[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  return value.flatMap((item) => {
    const jar = normalizeJar(item)
    if (!jar || seen.has(jar.id)) return []
    seen.add(jar.id)
    return [jar]
  })
}

export function normalizeInventoryState(value: unknown): InventoryState {
  if (!value || typeof value !== 'object') {
    return createEmptyInventoryState()
  }

  const state = value as Partial<InventoryState>
  return {
    ingredientUnits: normalizeIngredientUnits(state.ingredientUnits),
    waterUnits: normalizeCount(state.waterUnits),
    cleanCups: normalizeCount(state.cleanCups),
    usedCups: normalizeCount(state.usedCups),
    juiceJars: normalizeJars(state.juiceJars),
  }
}

export function readInventoryState(storage: StorageLike): InventoryState {
  const raw = storage.getItem(INVENTORY_STORAGE_KEY)
  if (raw === null) return createEmptyInventoryState()

  try {
    return normalizeInventoryState(JSON.parse(raw))
  } catch {
    return createEmptyInventoryState()
  }
}

export function writeInventoryState(
  storage: StorageLike,
  state: InventoryState,
): void {
  storage.setItem(
    INVENTORY_STORAGE_KEY,
    JSON.stringify(normalizeInventoryState(state)),
  )
}
