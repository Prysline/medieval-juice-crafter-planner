import {
  applyDeliveryExecutionCustomer,
  createDeliveryExecutionCursor,
  type DeliveryExecutionCursor,
  type DeliveryExecutionPlan,
  type DeliveryExecutionStepChanges,
} from '../domain/deliveryExecution'
import type { InventoryState } from '../types'
import {
  normalizeInventoryState,
  readInventoryState,
} from './inventoryState'
import {
  readPlanApplicationStoredState,
  writePlanApplicationStoredState,
} from './planApplicationState'
import {
  readSuppliedCustomerIds,
  type StorageLike,
} from './plannerState'

export type DeliveryExecutionCommitStaleField =
  | 'inventory'
  | 'supplied-customers'
  | 'execution-cursor'
  | 'execution-basis'

export interface DeliveryExecutionCommitBasis {
  readonly inventory: InventoryState
  readonly suppliedCustomerIds: readonly string[]
}

export interface CommitDeliveryExecutionCustomerInput {
  readonly plan: DeliveryExecutionPlan
  readonly cursor: DeliveryExecutionCursor
  readonly customerId: string
  readonly expectedBasis: DeliveryExecutionCommitBasis
}

export type DeliveryExecutionCommitResult =
  | {
      readonly status: 'applied'
      readonly inventory: InventoryState
      readonly suppliedCustomerIds: readonly string[]
      readonly cursor: DeliveryExecutionCursor
      readonly changes: DeliveryExecutionStepChanges
    }
  | {
      readonly status: 'stale'
      readonly mismatches: readonly DeliveryExecutionCommitStaleField[]
    }
  | {
      readonly status: 'error'
      readonly message: string
    }

function normalizedSupplied(
  values: readonly string[],
): string[] {
  return [...new Set(values)].sort()
}

function canonicalInventoryPayload(
  inventory: InventoryState,
) {
  const normalized = normalizeInventoryState(inventory)
  return {
    ingredientUnits: Object.fromEntries(
      Object.entries(normalized.ingredientUnits).sort(
        ([left], [right]) => left.localeCompare(right),
      ),
    ),
    waterUnits: normalized.waterUnits,
    cleanCups: normalized.cleanCups,
    usedCups: normalized.usedCups,
    juiceJars: normalized.juiceJars.map((jar) => ({
      id: jar.id,
      recipeId: jar.recipeId,
      servings: jar.servings,
    })),
    shelfCount: normalized.shelfCount,
    jarRackCount: normalized.jarRackCount,
  }
}

export function deliveryExecutionCanonicalBasisFingerprint(
  inventory: InventoryState,
  suppliedCustomerIds: readonly string[],
): string {
  return JSON.stringify({
    inventory: canonicalInventoryPayload(inventory),
    suppliedCustomerIds: normalizedSupplied(
      suppliedCustomerIds,
    ),
  })
}

function sameInventory(
  left: InventoryState,
  right: InventoryState,
): boolean {
  return (
    JSON.stringify(canonicalInventoryPayload(left)) ===
    JSON.stringify(canonicalInventoryPayload(right))
  )
}

function sameSupplied(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    JSON.stringify(normalizedSupplied(left)) ===
    JSON.stringify(normalizedSupplied(right))
  )
}

function sameCursor(
  left: DeliveryExecutionCursor,
  right: DeliveryExecutionCursor,
): boolean {
  return (
    left.planFingerprint === right.planFingerprint &&
    left.nextTripNumber === right.nextTripNumber &&
    left.tripPrepared === right.tripPrepared &&
    JSON.stringify(left.completedCustomerIdsInTrip) ===
      JSON.stringify(right.completedCustomerIdsInTrip)
  )
}

function startBasisMismatches(
  currentInventory: InventoryState,
  currentSuppliedCustomerIds: readonly string[],
  expected: DeliveryExecutionCommitBasis,
): DeliveryExecutionCommitStaleField[] {
  const mismatches: DeliveryExecutionCommitStaleField[] = []
  if (!sameInventory(currentInventory, expected.inventory)) {
    mismatches.push('inventory')
  }
  if (
    !sameSupplied(
      currentSuppliedCustomerIds,
      expected.suppliedCustomerIds,
    )
  ) {
    mismatches.push('supplied-customers')
  }
  return mismatches
}

function currentCanonicalState(storage: StorageLike): {
  inventory: InventoryState
  suppliedCustomerIds: string[]
} {
  const stored = readPlanApplicationStoredState(storage)
  if (stored) {
    return {
      inventory: normalizeInventoryState(stored.inventory),
      suppliedCustomerIds: [
        ...new Set(stored.suppliedCustomerIds),
      ],
    }
  }

  return {
    inventory: readInventoryState(storage),
    suppliedCustomerIds: readSuppliedCustomerIds(storage),
  }
}

export function commitDeliveryExecutionCustomer(
  input: CommitDeliveryExecutionCustomerInput,
  storage: StorageLike,
): DeliveryExecutionCommitResult {
  try {
    const stored = readPlanApplicationStoredState(storage)
    const current = currentCanonicalState(storage)
    const currentBasisFingerprint =
      deliveryExecutionCanonicalBasisFingerprint(
        current.inventory,
        current.suppliedCustomerIds,
      )
    const initialCursor =
      createDeliveryExecutionCursor(input.plan)

    if (stored?.deliveryExecution) {
      if (
        stored.deliveryExecution.canonicalBasisFingerprint !==
        currentBasisFingerprint
      ) {
        return Object.freeze({
          status: 'stale',
          mismatches: Object.freeze([
            'execution-basis',
          ] as const),
        })
      }

      if (
        stored.deliveryExecution.cursor.planFingerprint ===
        input.plan.planFingerprint
      ) {
        if (
          !sameCursor(
            stored.deliveryExecution.cursor,
            input.cursor,
          )
        ) {
          return Object.freeze({
            status: 'stale',
            mismatches: Object.freeze([
              'execution-cursor',
            ] as const),
          })
        }
      } else {
        // A newly solved plan may take over after partial delivery, but only
        // from the exact current canonical state and only with its initial
        // cursor. This ends the old plan's execution authority without
        // replaying any of its already committed events.
        const mismatches = startBasisMismatches(
          current.inventory,
          current.suppliedCustomerIds,
          input.expectedBasis,
        )
        if (!sameCursor(input.cursor, initialCursor)) {
          mismatches.push('execution-cursor')
        }
        if (mismatches.length > 0) {
          return Object.freeze({
            status: 'stale',
            mismatches: Object.freeze(mismatches),
          })
        }
      }
    } else {
      const mismatches = startBasisMismatches(
        current.inventory,
        current.suppliedCustomerIds,
        input.expectedBasis,
      )
      if (!sameCursor(input.cursor, initialCursor)) {
        mismatches.push('execution-cursor')
      }
      if (mismatches.length > 0) {
        return Object.freeze({
          status: 'stale',
          mismatches: Object.freeze(mismatches),
        })
      }
    }

    if (
      current.suppliedCustomerIds.includes(input.customerId)
    ) {
      return Object.freeze({
        status: 'error',
        message:
          `Customer ${input.customerId} is already supplied today`,
      })
    }

    const execution = applyDeliveryExecutionCustomer(
      input.plan,
      current.inventory,
      input.cursor,
      input.customerId,
    )
    const suppliedCustomerIds = [
      ...new Set([
        ...current.suppliedCustomerIds,
        input.customerId,
      ]),
    ]
    const nextBasisFingerprint =
      deliveryExecutionCanonicalBasisFingerprint(
        execution.inventory,
        suppliedCustomerIds,
      )

    // This is intentionally the only write in a successful partial commit.
    // Inventory, supplied-customer authority and execution cursor therefore
    // cannot persist as three independently drifting states.
    writePlanApplicationStoredState(storage, {
      inventory: execution.inventory,
      suppliedCustomerIds,
      deliveryExecution: {
        canonicalBasisFingerprint: nextBasisFingerprint,
        cursor: execution.cursor,
      },
    })

    return Object.freeze({
      status: 'applied',
      inventory: execution.inventory,
      suppliedCustomerIds: Object.freeze(
        [...suppliedCustomerIds],
      ),
      cursor: execution.cursor,
      changes: execution.changes,
    })
  } catch (error) {
    return Object.freeze({
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : '部分交付寫入失敗。',
    })
  }
}
