import { progressMilestoneIds } from '../data/progress'
import { villages } from '../data/villages'
import type {
  ProgressMilestoneId,
  SatisfactionByVillage,
} from '../types'
import {
  readPlanApplicationStoredState,
  updateStoredPlanApplicationSuppliedCustomers,
} from './planApplicationState'

type LegacyRuntimeStageId = 1 | 2 | 3 | 4

export const STORAGE_KEYS = {
  progress: 'mjc-progress',
  satisfactionByVillage: 'mjc-satisfaction-by-village',
  suppliedToday: 'mjc-supplied-today',
  formalCustomers: 'mjc-formal-customers',
  legacyStage: 'mjc-stage',
  legacySatisfaction: 'mjc-satisfaction',
} as const

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const progressIds = new Set<ProgressMilestoneId>(progressMilestoneIds)
const canonicalVillageIds = villages.map((village) => village.id)

export function isProgressMilestoneId(value: string): value is ProgressMilestoneId {
  return progressIds.has(value as ProgressMilestoneId)
}

export function legacyStageToProgress(
  stage: LegacyRuntimeStageId,
): ProgressMilestoneId {
  switch (stage) {
    case 1:
      return 'opening'
    case 2:
      return 'seasoner-unlocked'
    case 3:
      return 'juice-jar-unlocked'
    case 4:
      return 'juicer-unlocked'
  }
}

function parseLegacyStage(raw: string | null): LegacyRuntimeStageId | null {
  const value = Number(raw)
  return value === 1 || value === 2 || value === 3 || value === 4
    ? value
    : null
}

function normalizeSatisfaction(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

export function normalizeSatisfactionByVillageIds<TVillageId extends string>(
  villageIds: readonly TVillageId[],
  value: unknown,
): Record<TVillageId, number> {
  const source =
    value !== null && typeof value === 'object'
      ? value as Record<string, unknown>
      : {}

  return Object.fromEntries(
    villageIds.map((villageId) => [
      villageId,
      normalizeSatisfaction(source[villageId]),
    ]),
  ) as Record<TVillageId, number>
}

export function readCurrentProgress(storage: StorageLike): ProgressMilestoneId {
  const storedProgress = storage.getItem(STORAGE_KEYS.progress)
  if (storedProgress && isProgressMilestoneId(storedProgress)) {
    return storedProgress
  }

  const legacyStage = parseLegacyStage(storage.getItem(STORAGE_KEYS.legacyStage))
  const migrated = legacyStage
    ? legacyStageToProgress(legacyStage)
    : 'seasoner-unlocked'

  storage.setItem(STORAGE_KEYS.progress, migrated)
  return migrated
}

export function writeCurrentProgress(
  storage: StorageLike,
  progress: ProgressMilestoneId,
): void {
  storage.setItem(STORAGE_KEYS.progress, progress)
}

export function readSatisfactionByVillage(
  storage: StorageLike,
): SatisfactionByVillage {
  const stored = storage.getItem(STORAGE_KEYS.satisfactionByVillage)

  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as unknown
      if (parsed === null) {
        throw new Error('Stored satisfaction cannot be null')
      }
      return normalizeSatisfactionByVillageIds(canonicalVillageIds, parsed)
    } catch {
      // Fall through to the legacy value.
    }
  }

  const legacyRaw = storage.getItem(STORAGE_KEYS.legacySatisfaction)
  const legacyValue = legacyRaw === null ? 0 : Number(legacyRaw)
  const migrated = normalizeSatisfactionByVillageIds(canonicalVillageIds, {})
  migrated['east-harbor'] = normalizeSatisfaction(legacyValue)

  storage.setItem(STORAGE_KEYS.satisfactionByVillage, JSON.stringify(migrated))
  return migrated
}

export function writeSatisfactionByVillage(
  storage: StorageLike,
  satisfactionByVillage: SatisfactionByVillage,
): void {
  storage.setItem(
    STORAGE_KEYS.satisfactionByVillage,
    JSON.stringify(
      normalizeSatisfactionByVillageIds(
        canonicalVillageIds,
        satisfactionByVillage,
      ),
    ),
  )
}


function readStoredStringArray(
  storage: StorageLike,
  key: string,
): string[] {
  const raw = storage.getItem(key)
  if (raw === null) return []

  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []

    return [...new Set(
      value.filter((item): item is string => typeof item === 'string'),
    )]
  } catch {
    return []
  }
}

export function readFormalCustomerIds(storage: StorageLike): string[] {
  return readStoredStringArray(storage, STORAGE_KEYS.formalCustomers)
}

export function readSuppliedCustomerIds(storage: StorageLike): string[] {
  const storedPlanState = readPlanApplicationStoredState(storage)
  if (storedPlanState) {
    return [...storedPlanState.suppliedCustomerIds]
  }

  return readStoredStringArray(storage, STORAGE_KEYS.suppliedToday)
}

export function writeSuppliedCustomerIds(
  storage: StorageLike,
  customerIds: string[],
): void {
  const normalized = [...new Set(customerIds)]
  if (
    updateStoredPlanApplicationSuppliedCustomers(
      storage,
      normalized,
    )
  ) {
    return
  }

  storage.setItem(
    STORAGE_KEYS.suppliedToday,
    JSON.stringify(normalized),
  )
}

export function writeFormalCustomerIds(
  storage: StorageLike,
  customerIds: string[],
): void {
  storage.setItem(
    STORAGE_KEYS.formalCustomers,
    JSON.stringify([...new Set(customerIds)]),
  )
}
