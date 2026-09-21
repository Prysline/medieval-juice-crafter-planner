import { selectCarriedJuiceJars } from '../domain/inventoryCapacity'
import type {
  PlanApplicationBasisState,
  PlanApplicationTransactionDraft,
} from '../domain/planApplicationTransaction'
import {
  validatePlanApplicationTransactionBasis,
  type PlanApplicationBasisValidation,
} from '../domain/planApplicationValidation'
import type {
  ProgressMilestoneId,
  SatisfactionByVillage,
} from '../types'
import {
  readInventoryState,
} from './inventoryState'
import {
  normalizePlannerSettings,
  PLANNER_SETTINGS_STORAGE_KEY,
} from './plannerSettings'
import {
  isProgressMilestoneId,
  legacyStageToProgress,
  STORAGE_KEYS,
  type StorageLike,
} from './plannerState'

function readCurrentProgressReadonly(
  storage: StorageLike,
): ProgressMilestoneId {
  const storedProgress = storage.getItem(STORAGE_KEYS.progress)
  if (storedProgress && isProgressMilestoneId(storedProgress)) {
    return storedProgress
  }

  const legacyValue = Number(
    storage.getItem(STORAGE_KEYS.legacyStage),
  )
  if (
    legacyValue === 1 ||
    legacyValue === 2 ||
    legacyValue === 3 ||
    legacyValue === 4
  ) {
    return legacyStageToProgress(legacyValue)
  }

  return 'seasoner-unlocked'
}

function normalizeSatisfaction(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

function readSatisfactionByVillageReadonly(
  storage: StorageLike,
): SatisfactionByVillage {
  const stored = storage.getItem(
    STORAGE_KEYS.satisfactionByVillage,
  )

  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored)
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        const value = parsed as Partial<SatisfactionByVillage>
        return {
          'east-harbor': normalizeSatisfaction(
            value['east-harbor'],
          ),
          'tranquil-fountain': normalizeSatisfaction(
            value['tranquil-fountain'],
          ),
        }
      }
    } catch {
      // Fall through to the legacy value without migrating storage.
    }
  }

  const legacyRaw = storage.getItem(STORAGE_KEYS.legacySatisfaction)
  const legacyValue =
    legacyRaw === null ? 0 : Number(legacyRaw)

  return {
    'east-harbor': normalizeSatisfaction(legacyValue),
    'tranquil-fountain': 0,
  }
}

function readStoredStringSet(
  storage: StorageLike,
  key: string,
): string[] {
  const raw = storage.getItem(key)
  if (raw === null) return []

  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []

    return [
      ...new Set(
        value.filter(
          (item): item is string => typeof item === 'string',
        ),
      ),
    ]
  } catch {
    return []
  }
}

function readPlannerSettingsReadonly(
  storage: StorageLike,
  inventory: PlanApplicationBasisState['inventory'],
): PlanApplicationBasisState['plannerSettings'] {
  const raw = storage.getItem(PLANNER_SETTINGS_STORAGE_KEY)
  let parsed: unknown = null

  if (raw !== null) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }

  const normalized = normalizePlannerSettings(parsed, inventory)
  return {
    ...normalized,
    carriedJuiceJarIds: selectCarriedJuiceJars(
      inventory,
      normalized,
    ).map((jar) => jar.id),
  }
}

export function readPlanApplicationBasisState(
  storage: StorageLike,
): PlanApplicationBasisState {
  const inventory = readInventoryState(storage)

  return {
    inventory,
    currentProgress: readCurrentProgressReadonly(storage),
    satisfactionByVillage:
      readSatisfactionByVillageReadonly(storage),
    formalCustomerIds: readStoredStringSet(
      storage,
      STORAGE_KEYS.formalCustomers,
    ),
    suppliedCustomerIds: readStoredStringSet(
      storage,
      STORAGE_KEYS.suppliedToday,
    ),
    plannerSettings: readPlannerSettingsReadonly(
      storage,
      inventory,
    ),
  }
}

export function validateStoredPlanApplicationTransactionBasis(
  draft: PlanApplicationTransactionDraft,
  storage: StorageLike,
): PlanApplicationBasisValidation {
  return validatePlanApplicationTransactionBasis(
    draft,
    readPlanApplicationBasisState(storage),
  )
}
