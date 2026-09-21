import type { PlannerSettings } from '../types'
import type { StorageLike } from './plannerState'

export const PLANNER_SETTINGS_STORAGE_KEY = 'mjc-planner-settings'

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  carriedJuiceJarCount: 0,
  allowUsedCupDropIfFull: false,
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

export function normalizePlannerSettings(
  value: unknown,
): PlannerSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_PLANNER_SETTINGS }
  }

  const settings = value as Partial<PlannerSettings>
  return {
    carriedJuiceJarCount: normalizeCount(
      settings.carriedJuiceJarCount,
    ),
    allowUsedCupDropIfFull:
      settings.allowUsedCupDropIfFull === true,
  }
}

export function readPlannerSettings(
  storage: StorageLike,
): PlannerSettings {
  const raw = storage.getItem(PLANNER_SETTINGS_STORAGE_KEY)
  if (raw === null) return { ...DEFAULT_PLANNER_SETTINGS }

  try {
    return normalizePlannerSettings(JSON.parse(raw))
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
