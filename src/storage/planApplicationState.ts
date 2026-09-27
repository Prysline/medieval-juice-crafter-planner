import type { DeliveryExecutionCursor } from '../domain/deliveryExecution'
import type { InventoryState } from '../types'

export const PLAN_APPLICATION_STATE_STORAGE_KEY =
  'mjc-plan-application-state'

export const PLAN_APPLICATION_STATE_SCHEMA =
  'plan-application-state-v3' as const

const PREVIOUS_PLAN_APPLICATION_STATE_SCHEMA =
  'plan-application-state-v2' as const
const LEGACY_PLAN_APPLICATION_STATE_SCHEMA =
  'plan-application-state-v1' as const
const LEGACY_FORMAL_CUSTOMERS_STORAGE_KEY =
  'mjc-formal-customers' as const

interface StorageReadWrite {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PlanApplicationStoredDeliveryExecution {
  readonly canonicalBasisFingerprint: string
  readonly cursor: DeliveryExecutionCursor
}

export interface PlanApplicationStoredState {
  readonly schemaVersion: typeof PLAN_APPLICATION_STATE_SCHEMA
  readonly inventory: InventoryState
  readonly formalCustomerIds: readonly string[]
  readonly suppliedCustomerIds: readonly string[]
  readonly deliveryExecution: PlanApplicationStoredDeliveryExecution | null
}

function uniqueStrings(values: unknown[]): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string => typeof value === 'string',
      ),
    ),
  ]
}

function readLegacyFormalCustomerIds(
  storage: Pick<StorageReadWrite, 'getItem'>,
): string[] {
  const raw = storage.getItem(LEGACY_FORMAL_CUSTOMERS_STORAGE_KEY)
  if (raw === null) return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? uniqueStrings(parsed) : []
  } catch {
    return []
  }
}

function normalizeDeliveryExecutionCursor(
  value: unknown,
): DeliveryExecutionCursor | null {
  if (!value || typeof value !== 'object') return null

  const cursor = value as Partial<DeliveryExecutionCursor>
  if (
    typeof cursor.planFingerprint !== 'string' ||
    cursor.planFingerprint.length === 0 ||
    typeof cursor.nextTripNumber !== 'number' ||
    !Number.isInteger(cursor.nextTripNumber) ||
    cursor.nextTripNumber < 1 ||
    typeof cursor.tripPrepared !== 'boolean' ||
    !Array.isArray(cursor.completedCustomerIdsInTrip)
  ) {
    return null
  }

  return {
    planFingerprint: cursor.planFingerprint,
    nextTripNumber: cursor.nextTripNumber,
    tripPrepared: cursor.tripPrepared,
    completedCustomerIdsInTrip: uniqueStrings(
      cursor.completedCustomerIdsInTrip,
    ),
  }
}

function normalizeDeliveryExecution(
  value: unknown,
): PlanApplicationStoredDeliveryExecution | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return null

  const candidate = value as {
    canonicalBasisFingerprint?: unknown
    cursor?: unknown
  }
  if (
    typeof candidate.canonicalBasisFingerprint !== 'string' ||
    candidate.canonicalBasisFingerprint.length === 0
  ) {
    return null
  }

  const cursor = normalizeDeliveryExecutionCursor(candidate.cursor)
  if (!cursor) return null

  return {
    canonicalBasisFingerprint:
      candidate.canonicalBasisFingerprint,
    cursor,
  }
}

export function readPlanApplicationStoredState(
  storage: Pick<StorageReadWrite, 'getItem'>,
): PlanApplicationStoredState | null {
  const raw = storage.getItem(PLAN_APPLICATION_STATE_STORAGE_KEY)
  if (raw === null) return null

  try {
    const parsed = JSON.parse(raw) as {
      schemaVersion?: unknown
      inventory?: unknown
      formalCustomerIds?: unknown
      suppliedCustomerIds?: unknown
      deliveryExecution?: unknown
    }

    if (
      (
        parsed.schemaVersion !== PLAN_APPLICATION_STATE_SCHEMA &&
        parsed.schemaVersion !==
          PREVIOUS_PLAN_APPLICATION_STATE_SCHEMA &&
        parsed.schemaVersion !==
          LEGACY_PLAN_APPLICATION_STATE_SCHEMA
      ) ||
      !parsed.inventory ||
      typeof parsed.inventory !== 'object' ||
      !Array.isArray(parsed.suppliedCustomerIds)
    ) {
      return null
    }

    const hasDeliveryExecution =
      parsed.schemaVersion === PLAN_APPLICATION_STATE_SCHEMA ||
      parsed.schemaVersion === PREVIOUS_PLAN_APPLICATION_STATE_SCHEMA
    const deliveryExecution = hasDeliveryExecution
      ? normalizeDeliveryExecution(parsed.deliveryExecution)
      : null

    if (
      hasDeliveryExecution &&
      parsed.deliveryExecution !== null &&
      parsed.deliveryExecution !== undefined &&
      deliveryExecution === null
    ) {
      return null
    }

    if (
      parsed.schemaVersion === PLAN_APPLICATION_STATE_SCHEMA &&
      !Array.isArray(parsed.formalCustomerIds)
    ) {
      return null
    }

    const formalCustomerIds =
      parsed.schemaVersion === PLAN_APPLICATION_STATE_SCHEMA
        ? uniqueStrings(parsed.formalCustomerIds as unknown[])
        : readLegacyFormalCustomerIds(storage)

    return {
      schemaVersion: PLAN_APPLICATION_STATE_SCHEMA,
      inventory: parsed.inventory as InventoryState,
      formalCustomerIds,
      suppliedCustomerIds: uniqueStrings(
        parsed.suppliedCustomerIds,
      ),
      deliveryExecution,
    }
  } catch {
    return null
  }
}

export function writePlanApplicationStoredState(
  storage: StorageReadWrite,
  state: {
    inventory: InventoryState
    formalCustomerIds: readonly string[]
    suppliedCustomerIds: readonly string[]
    deliveryExecution?: PlanApplicationStoredDeliveryExecution | null
  },
): void {
  const serialized = JSON.stringify({
    schemaVersion: PLAN_APPLICATION_STATE_SCHEMA,
    inventory: state.inventory,
    formalCustomerIds: [
      ...new Set(state.formalCustomerIds),
    ],
    suppliedCustomerIds: [
      ...new Set(state.suppliedCustomerIds),
    ],
    deliveryExecution: state.deliveryExecution ?? null,
  })

  storage.setItem(PLAN_APPLICATION_STATE_STORAGE_KEY, serialized)
}

export function updateStoredPlanApplicationInventory(
  storage: StorageReadWrite,
  inventory: InventoryState,
): boolean {
  const current = readPlanApplicationStoredState(storage)
  if (!current) return false

  // A manual canonical inventory edit invalidates any in-flight delivery
  // execution cursor. The next delivery must start from a newly planned
  // execution session instead of replaying the old physical trace.
  writePlanApplicationStoredState(storage, {
    inventory,
    formalCustomerIds: current.formalCustomerIds,
    suppliedCustomerIds: current.suppliedCustomerIds,
    deliveryExecution: null,
  })
  return true
}

export function updateStoredPlanApplicationSuppliedCustomers(
  storage: StorageReadWrite,
  suppliedCustomerIds: readonly string[],
): boolean {
  const current = readPlanApplicationStoredState(storage)
  if (!current) return false

  // A manual supplied-customer edit changes optimizer authority and therefore
  // invalidates the existing delivery execution cursor.
  writePlanApplicationStoredState(storage, {
    inventory: current.inventory,
    formalCustomerIds: current.formalCustomerIds,
    suppliedCustomerIds,
    deliveryExecution: null,
  })
  return true
}

export function updateStoredPlanApplicationFormalCustomers(
  storage: StorageReadWrite,
  formalCustomerIds: readonly string[],
): boolean {
  const current = readPlanApplicationStoredState(storage)
  if (!current) return false

  writePlanApplicationStoredState(storage, {
    inventory: current.inventory,
    formalCustomerIds,
    suppliedCustomerIds: current.suppliedCustomerIds,
    deliveryExecution: null,
  })
  return true
}
