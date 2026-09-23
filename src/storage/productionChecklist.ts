import type { ProductionPlan } from '../domain/productionPlan'

export const PRODUCTION_CHECKLIST_STORAGE_KEY =
  'mjc-production-checklist'

export const PRODUCTION_CHECKLIST_SCHEMA =
  'production-checklist-v1' as const

interface StorageReadWrite {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ProductionChecklistState {
  readonly schemaVersion: typeof PRODUCTION_CHECKLIST_SCHEMA
  readonly planFingerprint: string
  readonly completedOperationIds: readonly string[]
}

function canonicalPlanPayload(plan: ProductionPlan): string {
  return JSON.stringify({
    schemaVersion: PRODUCTION_CHECKLIST_SCHEMA,
    steps: plan.steps.map((step) => ({
      key: step.key,
      kind: step.kind,
      equipment: step.equipment,
      fromIngredientIds: [...step.fromIngredientIds],
      secondaryFromIngredientIds: [
        ...(step.secondaryFromIngredientIds ?? []),
      ],
      toIngredientIds: [...step.toIngredientIds],
      addedIngredientId: step.addedIngredientId ?? null,
      quantity: step.quantity,
      operationCount: step.operationCount,
      recipeIds: [...step.recipeIds].sort(),
    })),
  })
}

/**
 * Stable identity for the exact net production plan shown to the player.
 *
 * The canonical payload itself is used as the fingerprint instead of a short
 * hash so a collision can never apply progress from an unrelated plan.
 */
export function productionPlanFingerprint(
  plan: ProductionPlan,
): string {
  return canonicalPlanPayload(plan)
}

export function productionOperationId(
  stepKey: string,
  batchIndex: number,
): string {
  return `${stepKey}#${batchIndex + 1}`
}

export function productionOperationIds(
  plan: ProductionPlan,
): string[] {
  return plan.steps.flatMap((step) =>
    Array.from(
      { length: step.operationCount },
      (_, index) => productionOperationId(step.key, index),
    ),
  )
}

function emptyChecklist(
  plan: ProductionPlan,
): ProductionChecklistState {
  return {
    schemaVersion: PRODUCTION_CHECKLIST_SCHEMA,
    planFingerprint: productionPlanFingerprint(plan),
    completedOperationIds: [],
  }
}

export function readProductionChecklist(
  storage: Pick<StorageReadWrite, 'getItem'>,
  plan: ProductionPlan,
): ProductionChecklistState {
  const expectedFingerprint = productionPlanFingerprint(plan)
  const raw = storage.getItem(PRODUCTION_CHECKLIST_STORAGE_KEY)
  if (raw === null) return emptyChecklist(plan)

  try {
    const parsed = JSON.parse(raw) as {
      schemaVersion?: unknown
      planFingerprint?: unknown
      completedOperationIds?: unknown
    }

    if (
      parsed.schemaVersion !== PRODUCTION_CHECKLIST_SCHEMA ||
      parsed.planFingerprint !== expectedFingerprint ||
      !Array.isArray(parsed.completedOperationIds)
    ) {
      return emptyChecklist(plan)
    }

    const validOperationIds = new Set(productionOperationIds(plan))
    const completedOperationIds = [
      ...new Set(
        parsed.completedOperationIds.filter(
          (value): value is string =>
            typeof value === 'string' &&
            validOperationIds.has(value),
        ),
      ),
    ]

    return {
      schemaVersion: PRODUCTION_CHECKLIST_SCHEMA,
      planFingerprint: expectedFingerprint,
      completedOperationIds,
    }
  } catch {
    return emptyChecklist(plan)
  }
}

export function writeProductionChecklist(
  storage: Pick<StorageReadWrite, 'setItem'>,
  plan: ProductionPlan,
  completedOperationIds: Iterable<string>,
): ProductionChecklistState {
  const validOperationIds = new Set(productionOperationIds(plan))
  const normalized = [
    ...new Set(
      [...completedOperationIds].filter((operationId) =>
        validOperationIds.has(operationId),
      ),
    ),
  ]

  const state: ProductionChecklistState = {
    schemaVersion: PRODUCTION_CHECKLIST_SCHEMA,
    planFingerprint: productionPlanFingerprint(plan),
    completedOperationIds: normalized,
  }

  storage.setItem(
    PRODUCTION_CHECKLIST_STORAGE_KEY,
    JSON.stringify(state),
  )
  return state
}
