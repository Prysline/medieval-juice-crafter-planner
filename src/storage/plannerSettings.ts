import { BACKPACK_SLOT_CAPACITY } from '../domain/inventoryRules'
import type { InventoryState, PlannerSettings } from '../types'
import type { StorageLike } from './plannerState'

export const PLANNER_SETTINGS_STORAGE_KEY = 'mjc-planner-settings'

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  carriedJuiceJarIds: [],
  allowUsedCupDropIfFull: false,
}

function normalizeJarIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    if (result.length >= BACKPACK_SLOT_CAPACITY) break
  }
  return result
}

function legacyCarriedJarIds(
  value: unknown,
  inventory?: InventoryState,
): string[] {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !inventory
  ) {
    return []
  }

  const count = Math.min(
    BACKPACK_SLOT_CAPACITY,
    inventory.juiceJars.length,
    Math.max(0, Math.floor(value)),
  )
  return inventory.juiceJars.slice(0, count).map((jar) => jar.id)
}

export function normalizePlannerSettings(
  value: unknown,
  inventory?: InventoryState,
): PlannerSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_PLANNER_SETTINGS }
  }

  const settings = value as Partial<PlannerSettings> & {
    carriedJuiceJarCount?: unknown
  }
  const hasCanonicalIds = Array.isArray(settings.carriedJuiceJarIds)

  return {
    carriedJuiceJarIds: hasCanonicalIds
      ? normalizeJarIds(settings.carriedJuiceJarIds)
      : legacyCarriedJarIds(
          settings.carriedJuiceJarCount,
          inventory,
        ),
    allowUsedCupDropIfFull:
      settings.allowUsedCupDropIfFull === true,
  }
}

export function readPlannerSettings(
  storage: StorageLike,
  inventory?: InventoryState,
): PlannerSettings {
  const raw = storage.getItem(PLANNER_SETTINGS_STORAGE_KEY)
  if (raw === null) return { ...DEFAULT_PLANNER_SETTINGS }

  try {
    const parsed = JSON.parse(raw)
    const normalized = normalizePlannerSettings(parsed, inventory)
    const legacy =
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(
        (parsed as { carriedJuiceJarIds?: unknown })
          .carriedJuiceJarIds,
      ) &&
      typeof (parsed as { carriedJuiceJarCount?: unknown })
        .carriedJuiceJarCount === 'number'

    if (legacy && inventory) {
      storage.setItem(
        PLANNER_SETTINGS_STORAGE_KEY,
        JSON.stringify(normalized),
      )
    }
    return normalized
  } catch {
    return { ...DEFAULT_PLANNER_SETTINGS }
  }
}

export function writePlannerSettings(
  storage: StorageLike,
  settings: PlannerSettings,
): void {
  storage.setItem(
    PLANNER_SETTINGS_STORAGE_KEY,
    JSON.stringify(normalizePlannerSettings(settings)),
  )
}
