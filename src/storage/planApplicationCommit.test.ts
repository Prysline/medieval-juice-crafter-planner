import { describe, expect, it } from 'vitest'
import type {
  PlanApplicationBasisState,
  PlanApplicationTransactionDraft,
} from '../domain/planApplicationTransaction'
import {
  INVENTORY_STORAGE_KEY,
  readInventoryState,
  writeInventoryState,
} from './inventoryState'
import {
  commitPlanApplicationTransaction,
} from './planApplicationCommit'
import {
  PLAN_APPLICATION_STATE_STORAGE_KEY,
} from './planApplicationState'
import {
  PLANNER_SETTINGS_STORAGE_KEY,
} from './plannerSettings'
import {
  readSuppliedCustomerIds,
  STORAGE_KEYS,
  type StorageLike,
  writeSuppliedCustomerIds,
} from './plannerState'

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>()
  writes: Array<{ key: string; value: string }> = []
  failOnWriteKey: string | null = null

  constructor(initial: Record<string, string>) {
    this.values = new Map(Object.entries(initial))
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    if (this.failOnWriteKey === key) {
      throw new Error('simulated storage failure')
    }
    this.writes.push({ key, value })
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  replaceRaw(key: string, value: string) {
    this.values.set(key, value)
  }

  raw(key: string) {
    return this.values.get(key) ?? null
  }
}

function initialInventory() {
  return {
    ingredientUnits: { lemon: 3, mint: 2 },
    waterUnits: 6,
    cleanCups: 3,
    usedCups: 1,
    juiceJars: [
      { id: 'jar-1', recipeId: 'lemon-juice', servings: 4 },
      { id: 'jar-2', recipeId: null, servings: 0 },
    ],
    shelfCount: 2,
    jarRackCount: 1,
  }
}

function basis(): PlanApplicationBasisState {
  return {
    inventory: initialInventory(),
    currentProgress: 'juice-jar-unlocked',
    satisfactionByVillage: {
      'east-harbor': 12,
      'tranquil-fountain': 0,
    },
    formalCustomerIds: ['jack'],
    suppliedCustomerIds: ['ulrich'],
    plannerSettings: {
      carriedJuiceJarIds: ['jar-1', 'jar-2'],
      allowUsedCupDropIfFull: false,
    },
  }
}

function draftFromBasis(
  source: PlanApplicationBasisState,
): PlanApplicationTransactionDraft {
  const beforeInventory = {
    ...source.inventory,
    ingredientUnits: { ...source.inventory.ingredientUnits },
    juiceJars: source.inventory.juiceJars.map((jar) => ({ ...jar })),
  }
  const afterInventory = {
    ...beforeInventory,
    ingredientUnits: { lemon: 1, mint: 2 },
    waterUnits: 2,
    cleanCups: 1,
    usedCups: 3,
    juiceJars: [
      { id: 'jar-1', recipeId: 'lemon-juice', servings: 2 },
      { id: 'jar-2', recipeId: 'mint-lemon', servings: 4 },
    ],
  }
  const snapshot = {
    currentProgress: source.currentProgress,
    satisfactionByVillage: { ...source.satisfactionByVillage },
    formalCustomerIds: [...source.formalCustomerIds],
    plannerSettings: {
      carriedJuiceJarIds: [...source.plannerSettings.carriedJuiceJarIds],
      allowUsedCupDropIfFull:
        source.plannerSettings.allowUsedCupDropIfFull,
    },
  }

  return {
    schemaVersion: 'plan-application-v1',
    before: {
      ...snapshot,
      inventory: beforeInventory,
      suppliedCustomerIds: [...source.suppliedCustomerIds],
    },
    after: {
      ...snapshot,
      inventory: afterInventory,
      suppliedCustomerIds: [...source.suppliedCustomerIds, 'alia'],
    },
    changes: {
      ingredients: [{
        ingredientId: 'lemon',
        beforeUnits: 3,
        afterUnits: 1,
        consumedFromInventory: 2,
        acquiredAndConsumedUnits: 0,
      }],
      water: {
        beforeUnits: 6,
        afterUnits: 2,
        consumedFromInventory: 4,
        productionUnitsRequired: 2,
        cupWashUnitsRequired: 2,
        externalUnitsRequired: 0,
      },
      cups: {
        cleanBefore: 3,
        cleanAfter: 1,
        usedBefore: 1,
        usedAfter: 3,
        physicalBefore: 4,
        physicalAfter: 4,
        droppedUsedCups: 0,
      },
      juiceJars: [],
      newlySuppliedCustomerIds: ['alia'],
    },
  }
}

function legacyStorage(): MemoryStorage {
  const source = basis()
  return new MemoryStorage({
    [INVENTORY_STORAGE_KEY]: JSON.stringify(source.inventory),
    [STORAGE_KEYS.progress]: source.currentProgress,
    [STORAGE_KEYS.satisfactionByVillage]: JSON.stringify(
      source.satisfactionByVillage,
    ),
    [STORAGE_KEYS.formalCustomers]: JSON.stringify(
      source.formalCustomerIds,
    ),
    [STORAGE_KEYS.suppliedToday]: JSON.stringify(
      source.suppliedCustomerIds,
    ),
    [PLANNER_SETTINGS_STORAGE_KEY]: JSON.stringify(
      source.plannerSettings,
    ),
  })
}

describe('plan application commit', () => {
  it('commits inventory and supplied customers through one canonical storage write', () => {
    const storage = legacyStorage()
    const source = basis()
    const draft = draftFromBasis(source)
    const legacyInventoryRaw = storage.raw(INVENTORY_STORAGE_KEY)
    const legacySuppliedRaw = storage.raw(STORAGE_KEYS.suppliedToday)

    const result = commitPlanApplicationTransaction(draft, storage)

    expect(result).toEqual({
      status: 'applied',
      inventory: draft.after.inventory,
      suppliedCustomerIds: ['ulrich', 'alia'],
    })
    expect(storage.writes).toHaveLength(1)
    expect(storage.writes[0]?.key).toBe(
      PLAN_APPLICATION_STATE_STORAGE_KEY,
    )
    expect(readInventoryState(storage)).toEqual(draft.after.inventory)
    expect(readSuppliedCustomerIds(storage)).toEqual([
      'ulrich',
      'alia',
    ])

    expect(storage.raw(INVENTORY_STORAGE_KEY)).toBe(legacyInventoryRaw)
    expect(storage.raw(STORAGE_KEYS.suppliedToday)).toBe(legacySuppliedRaw)
    expect(storage.raw(STORAGE_KEYS.progress)).toBe(
      source.currentProgress,
    )
    expect(storage.raw(STORAGE_KEYS.satisfactionByVillage)).toBe(
      JSON.stringify(source.satisfactionByVillage),
    )
    expect(storage.raw(STORAGE_KEYS.formalCustomers)).toBe(
      JSON.stringify(source.formalCustomerIds),
    )
    expect(storage.raw(PLANNER_SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify(source.plannerSettings),
    )
  })

  it('rejects stale basis without writing anything', () => {
    const storage = legacyStorage()
    const draft = draftFromBasis(basis())
    storage.replaceRaw(
      STORAGE_KEYS.satisfactionByVillage,
      JSON.stringify({
        'east-harbor': 13,
        'tranquil-fountain': 0,
      }),
    )

    const result = commitPlanApplicationTransaction(draft, storage)

    expect(result).toEqual({
      status: 'stale',
      mismatches: ['satisfaction'],
    })
    expect(storage.writes).toEqual([])
    expect(storage.raw(PLAN_APPLICATION_STATE_STORAGE_KEY)).toBeNull()
  })

  it('leaves legacy state untouched when the single canonical write throws', () => {
    const storage = legacyStorage()
    const draft = draftFromBasis(basis())
    const snapshot = {
      inventory: storage.raw(INVENTORY_STORAGE_KEY),
      supplied: storage.raw(STORAGE_KEYS.suppliedToday),
    }
    storage.failOnWriteKey = PLAN_APPLICATION_STATE_STORAGE_KEY

    const result = commitPlanApplicationTransaction(draft, storage)

    expect(result).toEqual({
      status: 'error',
      message: 'simulated storage failure',
    })
    expect(storage.raw(PLAN_APPLICATION_STATE_STORAGE_KEY)).toBeNull()
    expect(storage.raw(INVENTORY_STORAGE_KEY)).toBe(snapshot.inventory)
    expect(storage.raw(STORAGE_KEYS.suppliedToday)).toBe(snapshot.supplied)
    expect(storage.writes).toEqual([])
  })

  it('routes later inventory and supplied edits through the adopted envelope', () => {
    const storage = legacyStorage()
    const draft = draftFromBasis(basis())

    expect(commitPlanApplicationTransaction(draft, storage).status).toBe(
      'applied',
    )
    storage.writes = []

    writeInventoryState(storage, {
      ...draft.after.inventory,
      waterUnits: 9,
    })
    expect(storage.writes).toHaveLength(1)
    expect(storage.writes[0]?.key).toBe(
      PLAN_APPLICATION_STATE_STORAGE_KEY,
    )
    expect(readSuppliedCustomerIds(storage)).toEqual([
      'ulrich',
      'alia',
    ])

    storage.writes = []
    writeSuppliedCustomerIds(storage, ['alia'])
    expect(storage.writes).toHaveLength(1)
    expect(storage.writes[0]?.key).toBe(
      PLAN_APPLICATION_STATE_STORAGE_KEY,
    )
    expect(readInventoryState(storage).waterUnits).toBe(9)
    expect(readSuppliedCustomerIds(storage)).toEqual(['alia'])
  })
})
