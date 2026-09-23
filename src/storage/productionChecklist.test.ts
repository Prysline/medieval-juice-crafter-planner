import { describe, expect, it } from 'vitest'
import type { ProductionPlan } from '../domain/productionPlan'
import {
  PRODUCTION_CHECKLIST_STORAGE_KEY,
  productionOperationId,
  productionOperationIds,
  productionPlanFingerprint,
  readProductionChecklist,
  writeProductionChecklist,
} from './productionChecklist'

function plan(
  overrides: Partial<ProductionPlan['steps'][number]> = {},
): ProductionPlan {
  return {
    steps: [
      {
        key: 'juice:lemon',
        kind: 'juicing',
        equipment: '柑橘榨汁機',
        fromIngredientIds: [],
        toIngredientIds: ['lemon'],
        addedIngredientId: 'lemon',
        quantity: 7,
        operationCount: 2,
        recipeIds: ['recipe-b', 'recipe-a'],
        ...overrides,
      },
    ],
    machineOperations: {
      total: overrides.operationCount ?? 2,
      juicing: overrides.kind && overrides.kind !== 'juicing'
        ? 0
        : overrides.operationCount ?? 2,
      seasoning: overrides.kind === 'seasoning'
        ? overrides.operationCount ?? 2
        : 0,
      blending: overrides.kind === 'blending'
        ? overrides.operationCount ?? 2
        : 0,
      finalizing: overrides.kind === 'finalizing'
        ? overrides.operationCount ?? 2
        : 0,
    },
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}

describe('production checklist storage', () => {
  it('builds a stable fingerprint from the exact net production plan', () => {
    const first = plan()
    const equivalent = plan({
      recipeIds: ['recipe-a', 'recipe-b'],
    })

    expect(productionPlanFingerprint(first)).toBe(
      productionPlanFingerprint(equivalent),
    )
    expect(
      productionPlanFingerprint(
        plan({ quantity: 6 }),
      ),
    ).not.toBe(productionPlanFingerprint(first))
    expect(
      productionPlanFingerprint(
        plan({ recipeIds: ['recipe-c'] }),
      ),
    ).not.toBe(productionPlanFingerprint(first))
  })

  it('gives every displayed machine batch a stable operation identity', () => {
    expect(productionOperationIds(plan())).toEqual([
      'juice:lemon#1',
      'juice:lemon#2',
    ])
    expect(productionOperationId('finish:lemon>sugar', 0)).toBe(
      'finish:lemon>sugar#1',
    )
  })

  it('restores arbitrary completion order for the same plan only', () => {
    const storage = memoryStorage()
    const currentPlan = plan()

    writeProductionChecklist(storage, currentPlan, [
      'juice:lemon#2',
      'juice:lemon#1',
    ])

    expect(
      readProductionChecklist(
        storage,
        currentPlan,
      ).completedOperationIds,
    ).toEqual(['juice:lemon#2', 'juice:lemon#1'])

    expect(
      readProductionChecklist(
        storage,
        plan({ quantity: 6 }),
      ).completedOperationIds,
    ).toEqual([])
  })

  it('filters stale or invalid operation ids without changing the production plan', () => {
    const currentPlan = plan()
    const before = JSON.stringify(currentPlan)
    const storage = memoryStorage({
      [PRODUCTION_CHECKLIST_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 'production-checklist-v1',
        planFingerprint: productionPlanFingerprint(currentPlan),
        completedOperationIds: [
          'juice:lemon#2',
          'juice:lemon#99',
          'juice:lemon#2',
          123,
        ],
      }),
    })

    expect(
      readProductionChecklist(
        storage,
        currentPlan,
      ).completedOperationIds,
    ).toEqual(['juice:lemon#2'])
    expect(JSON.stringify(currentPlan)).toBe(before)
  })

  it('persists a reset as an empty checklist for the same plan', () => {
    const storage = memoryStorage()
    const currentPlan = plan()

    writeProductionChecklist(storage, currentPlan, [
      'juice:lemon#1',
    ])
    writeProductionChecklist(storage, currentPlan, [])

    expect(
      readProductionChecklist(
        storage,
        currentPlan,
      ).completedOperationIds,
    ).toEqual([])
  })
})
