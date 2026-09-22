import { BACKPACK_SLOT_CAPACITY } from '../domain/inventoryRules'
import type { InventoryState, PlannerSettings } from '../types'
import type { StorageLike } from './plannerState'

export const PLANNER_SETTINGS_STORAGE_KEY = 'mjc-planner-settings'

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  juiceJarCarryMode: 'auto',
  reservedJuiceJarSlots: 0,
  allowUsedCupDropIfFull: false,
}

function normalizeSlotCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(
        BACKPACK_SLOT_CAPACITY,
        Math.max(0, Math.floor(value)),
      )
    : 0
}

function normalizeLegacyJarIds(
  value: unknown,
  inventory?: InventoryState,
): string[] {
  if (!Array.isArray(value)) return []

  const ownedIds = inventory
    ? new Set(inventory.juiceJars.map((jar) => jar.id))
    : null
  const seen = new Set<string>()
  const result: string[] = []

  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (
      !id ||
      seen.has(id) ||
      (ownedIds && !ownedIds.has(id))
    ) {
      continue
    }
    seen.add(id)
    result.push(id)
    if (result.length >= BACKPACK_SLOT_CAPACITY) break
  }

  return result
}

function legacyCarriedSlotCount(
  settings: {
    carriedJuiceJarIds?: unknown
    carriedJuiceJarCount?: unknown
  },
  inventory?: InventoryState,
): number | null {
  if (Array.isArray(settings.carriedJuiceJarIds)) {
    return normalizeLegacyJarIds(
      settings.carriedJuiceJarIds,
      inventory,
    ).length
  }

  if (
    typeof settings.carriedJuiceJarCount === 'number' &&
    Number.isFinite(settings.carriedJuiceJarCount)
  ) {
    const requested = normalizeSlotCount(
      settings.carriedJuiceJarCount,
    )
    return inventory
      ? Math.min(requested, inventory.juiceJars.length)
      : requested
  }

  return null
}

export function normalizePlannerSettings(
  value: unknown,
  inventory?: InventoryState,
): PlannerSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_PLANNER_SETTINGS }
  }

  const settings = value as Partial<PlannerSettings> & {
    carriedJuiceJarIds?: unknown
    carriedJuiceJarCount?: unknown
  }

  if (
    settings.juiceJarCarryMode === 'auto' ||
    settings.juiceJarCarryMode === 'fixed-slots'
  ) {
    return {
      juiceJarCarryMode: settings.juiceJarCarryMode,
      reservedJuiceJarSlots: normalizeSlotCount(
        settings.reservedJuiceJarSlots,
      ),
      allowUsedCupDropIfFull:
        settings.allowUsedCupDropIfFull === true,
    }
  }

  const legacySlots = legacyCarriedSlotCount(
    settings,
    inventory,
  )

  return legacySlots === null
    ? {
        ...DEFAULT_PLANNER_SETTINGS,
        allowUsedCupDropIfFull:
          settings.allowUsedCupDropIfFull === true,
      }
    : {
        juiceJarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: legacySlots,
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
    const isCanonical =
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { juiceJarCarryMode?: unknown })
        .juiceJarCarryMode !== undefined

    if (!isCanonical) {
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
