import type { InventoryState } from '../types'

export const PLAN_APPLICATION_STATE_STORAGE_KEY =
  'mjc-plan-application-state'

export const PLAN_APPLICATION_STATE_SCHEMA =
  'plan-application-state-v1' as const

interface StorageReadWrite {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PlanApplicationStoredState {
  readonly schemaVersion: typeof PLAN_APPLICATION_STATE_SCHEMA
  readonly inventory: InventoryState
  readonly suppliedCustomerIds: readonly string[]
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(
    values.filter((value): value is string => typeof value === 'string'),
  )]
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
      suppliedCustomerIds?: unknown
    }

    if (
      parsed.schemaVersion !== PLAN_APPLICATION_STATE_SCHEMA ||
      !parsed.inventory ||
      typeof parsed.inventory !== 'object' ||
      !Array.isArray(parsed.suppliedCustomerIds)
    ) {
      return null
    }

    return {
      schemaVersion: PLAN_APPLICATION_STATE_SCHEMA,
      inventory: parsed.inventory as InventoryState,
      suppliedCustomerIds: uniqueStrings(parsed.suppliedCustomerIds),
    }
  } catch {
    return null
  }
}

export function writePlanApplicationStoredState(
  storage: StorageReadWrite,
  state: {
    inventory: InventoryState
    suppliedCustomerIds: readonly string[]
  },
): void {
  const serialized = JSON.stringify({
    schemaVersion: PLAN_APPLICATION_STATE_SCHEMA,
    inventory: state.inventory,
    suppliedCustomerIds: [...new Set(state.suppliedCustomerIds)],
  })

  storage.setItem(PLAN_APPLICATION_STATE_STORAGE_KEY, serialized)
}

export function updateStoredPlanApplicationInventory(
  storage: StorageReadWrite,
  inventory: InventoryState,
): boolean {
  const current = readPlanApplicationStoredState(storage)
  if (!current) return false

  writePlanApplicationStoredState(storage, {
    inventory,
    suppliedCustomerIds: current.suppliedCustomerIds,
  })
  return true
}

export function updateStoredPlanApplicationSuppliedCustomers(
  storage: StorageReadWrite,
  suppliedCustomerIds: readonly string[],
): boolean {
  const current = readPlanApplicationStoredState(storage)
  if (!current) return false

  writePlanApplicationStoredState(storage, {
    inventory: current.inventory,
    suppliedCustomerIds,
  })
  return true
}
