import type {
  PlanApplicationBasisMismatchField,
} from '../domain/planApplicationValidation'
import {
  rebasePlanApplicationTransactionSuppliedCustomers,
  type PlanApplicationTransactionDraft,
} from '../domain/planApplicationTransaction'
import type { InventoryState } from '../types'
import { normalizeInventoryState } from './inventoryState'
import {
  readPlanApplicationBasisState,
  validateStoredPlanApplicationTransactionBasis,
} from './planApplicationBasis'
import {
  writePlanApplicationStoredState,
} from './planApplicationState'
import type { StorageLike } from './plannerState'

export type PlanApplicationCommitResult =
  | {
      readonly status: 'applied'
      readonly inventory: InventoryState
      readonly suppliedCustomerIds: readonly string[]
    }
  | {
      readonly status: 'stale'
      readonly mismatches: readonly PlanApplicationBasisMismatchField[]
    }
  | {
      readonly status: 'error'
      readonly message: string
    }

function inventoryFromTransaction(
  draft: PlanApplicationTransactionDraft,
): InventoryState {
  return normalizeInventoryState({
    ingredientUnits: { ...draft.after.inventory.ingredientUnits },
    intermediateJuiceUnits: {
      ...draft.after.inventory.intermediateJuiceUnits,
    },
    waterUnits: draft.after.inventory.waterUnits,
    cleanCups: draft.after.inventory.cleanCups,
    usedCups: draft.after.inventory.usedCups,
    juiceJars: draft.after.inventory.juiceJars.map((jar) => ({
      id: jar.id,
      recipeId: jar.recipeId,
      servings: jar.servings,
    })),
    shelfCount: draft.after.inventory.shelfCount,
    jarRackCount: draft.after.inventory.jarRackCount,
  })
}

export function commitPlanApplicationTransaction(
  draft: PlanApplicationTransactionDraft,
  storage: StorageLike,
): PlanApplicationCommitResult {
  try {
    const currentBasis = readPlanApplicationBasisState(storage)
    const rebasedDraft =
      rebasePlanApplicationTransactionSuppliedCustomers(
        draft,
        currentBasis.suppliedCustomerIds,
      )
    const effectiveDraft = rebasedDraft ?? draft
    const validation =
      validateStoredPlanApplicationTransactionBasis(
        effectiveDraft,
        storage,
      )

    if (!validation.valid) {
      return Object.freeze({
        status: 'stale',
        mismatches: Object.freeze([...validation.mismatches]),
      })
    }

    const inventory = inventoryFromTransaction(effectiveDraft)
    const suppliedCustomerIds = [
      ...new Set(effectiveDraft.after.suppliedCustomerIds),
    ]

    writePlanApplicationStoredState(storage, {
      inventory,
      suppliedCustomerIds,
    })

    return Object.freeze({
      status: 'applied',
      inventory,
      suppliedCustomerIds: Object.freeze(suppliedCustomerIds),
    })
  } catch (error) {
    return Object.freeze({
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : '套用規劃時寫入儲存空間失敗。',
    })
  }
}
