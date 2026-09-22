import { describe, expect, it } from 'vitest'
import type {
  PlanApplicationBasisState,
  PlanApplicationTransactionDraft,
} from '../domain/planApplicationTransaction'
import { INVENTORY_STORAGE_KEY } from './inventoryState'
import {
  readPlanApplicationBasisState,
  validateStoredPlanApplicationTransactionBasis,
} from './planApplicationBasis'
import { PLANNER_SETTINGS_STORAGE_KEY } from './plannerSettings'
import {
  STORAGE_KEYS,
  type StorageLike,
} from './plannerState'

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>()
  writes: Array<{ key: string; value: string }> = []

  constructor(initial: Record<string, string> = {}) {
    this.values = new Map(Object.entries(initial))
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.writes.push({ key, value })
    this.values.set(key, value)
  }

  replaceRaw(key: string, value: string) {
    this.values.set(key, value)
  }
}

function inventoryValue(waterUnits = 4) {
  return JSON.stringify({
    ingredientUnits: {
      lemon: 3,
    },
    waterUnits,
    cleanCups: 2,
    usedCups: 1,
    juiceJars: [
      {
        id: 'jar-b',
        recipeId: 'lemon-juice',
        servings: 2,
      },
      {
        id: 'jar-a',
        recipeId: null,
        servings: 0,
      },
    ],
    shelfCount: 1,
    jarRackCount: 1,
  })
}

function draftFromBasis(
  source: PlanApplicationBasisState,
): PlanApplicationTransactionDraft {
  const inventory = {
    ingredientUnits: { ...source.inventory.ingredientUnits },
    waterUnits: source.inventory.waterUnits,
    cleanCups: source.inventory.cleanCups,
    usedCups: source.inventory.usedCups,
    juiceJars: source.inventory.juiceJars.map((jar) => ({
      ...jar,
    })),
    shelfCount: source.inventory.shelfCount,
    jarRackCount: source.inventory.jarRackCount,
  }
  const snapshot = {
    inventory,
    currentProgress: source.currentProgress,
    satisfactionByVillage: {
      ...source.satisfactionByVillage,
    },
    formalCustomerIds: [...source.formalCustomerIds],
    suppliedCustomerIds: [...source.suppliedCustomerIds],
    plannerSettings: {
      juiceJarCarryMode: source.plannerSettings.juiceJarCarryMode,
      reservedJuiceJarSlots:
        source.plannerSettings.reservedJuiceJarSlots,
      allowUsedCupDropIfFull:
        source.plannerSettings.allowUsedCupDropIfFull,
    },
  }

  return {
    schemaVersion: 'plan-application-v1',
    before: snapshot,
    after: {
      ...snapshot,
      inventory: {
        ...inventory,
        ingredientUnits: { ...inventory.ingredientUnits },
        juiceJars: inventory.juiceJars.map((jar) => ({
          ...jar,
        })),
      },
      satisfactionByVillage: {
        ...snapshot.satisfactionByVillage,
      },
      formalCustomerIds: [...snapshot.formalCustomerIds],
      suppliedCustomerIds: [...snapshot.suppliedCustomerIds],
      plannerSettings: {
        juiceJarCarryMode:
          snapshot.plannerSettings.juiceJarCarryMode,
        reservedJuiceJarSlots:
          snapshot.plannerSettings.reservedJuiceJarSlots,
        allowUsedCupDropIfFull:
          snapshot.plannerSettings.allowUsedCupDropIfFull,
        allowDiscardRetainedJuice:
          snapshot.plannerSettings.allowDiscardRetainedJuice,
      },
    },
    changes: {
      ingredients: [],
      water: {
        beforeUnits: inventory.waterUnits,
        afterUnits: inventory.waterUnits,
        consumedFromInventory: 0,
        productionUnitsRequired: 0,
        cupWashUnitsRequired: 0,
        externalUnitsRequired: 0,
      },
      cups: {
        cleanBefore: inventory.cleanCups,
        cleanAfter: inventory.cleanCups,
        usedBefore: inventory.usedCups,
        usedAfter: inventory.usedCups,
        physicalBefore: inventory.cleanCups + inventory.usedCups,
        physicalAfter: inventory.cleanCups + inventory.usedCups,
        droppedUsedCups: 0,
      },
      juiceJars: [],
      discardedJuice: [],
      newlySuppliedCustomerIds: [],
    },
  }
}

function legacyStorage(): MemoryStorage {
  return new MemoryStorage({
    [INVENTORY_STORAGE_KEY]: inventoryValue(),
    [STORAGE_KEYS.legacyStage]: '1',
    [STORAGE_KEYS.legacySatisfaction]: '12.8',
    [STORAGE_KEYS.formalCustomers]: JSON.stringify([
      'jack',
      'nanette',
      'jack',
    ]),
    [STORAGE_KEYS.suppliedToday]: JSON.stringify([
      'ulrich',
      'alia',
      'ulrich',
    ]),
    [PLANNER_SETTINGS_STORAGE_KEY]: JSON.stringify({
      carriedJuiceJarCount: 1,
      allowUsedCupDropIfFull: true,
      allowDiscardRetainedJuice: false,
    }),
  })
}

describe('stored plan application basis', () => {
  it('reconstructs legacy-equivalent canonical state without migration writes', () => {
    const storage = legacyStorage()

    expect(readPlanApplicationBasisState(storage)).toEqual({
      inventory: {
        ingredientUnits: {
          lemon: 3,
        },
        waterUnits: 4,
        cleanCups: 2,
        usedCups: 1,
        juiceJars: [
          {
            id: 'jar-b',
            recipeId: 'lemon-juice',
            servings: 2,
          },
          {
            id: 'jar-a',
            recipeId: null,
            servings: 0,
          },
        ],
        shelfCount: 1,
        jarRackCount: 1,
      },
      currentProgress: 'opening',
      satisfactionByVillage: {
        'east-harbor': 12,
        'tranquil-fountain': 0,
      },
      formalCustomerIds: ['jack', 'nanette'],
      suppliedCustomerIds: ['ulrich', 'alia'],
      plannerSettings: {
        juiceJarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: 1,
        allowUsedCupDropIfFull: true,
      allowDiscardRetainedJuice: false,
      },
    })
    expect(storage.writes).toEqual([])
  })

  it('validates a matching stored basis without writing migration or transaction state', () => {
    const storage = legacyStorage()
    const basis = readPlanApplicationBasisState(storage)
    const draft = draftFromBasis(basis)

    expect(
      validateStoredPlanApplicationTransactionBasis(
        draft,
        storage,
      ),
    ).toEqual({
      valid: true,
      stale: false,
      mismatches: [],
    })
    expect(storage.writes).toEqual([])
  })

  it('reports stale inventory after storage changes and still performs no writes', () => {
    const storage = legacyStorage()
    const basis = readPlanApplicationBasisState(storage)
    const draft = draftFromBasis(basis)

    storage.replaceRaw(
      INVENTORY_STORAGE_KEY,
      inventoryValue(5),
    )

    expect(
      validateStoredPlanApplicationTransactionBasis(
        draft,
        storage,
      ),
    ).toEqual({
      valid: false,
      stale: true,
      mismatches: ['inventory'],
    })
    expect(storage.writes).toEqual([])
  })

  it('normalizes legacy carried jar IDs to a slot count without retaining identities', () => {
    const storage = new MemoryStorage({
      [INVENTORY_STORAGE_KEY]: inventoryValue(),
      [STORAGE_KEYS.progress]: 'opening',
      [STORAGE_KEYS.satisfactionByVillage]: JSON.stringify({
        'east-harbor': 0,
        'tranquil-fountain': 0,
      }),
      [PLANNER_SETTINGS_STORAGE_KEY]: JSON.stringify({
        carriedJuiceJarIds: ['jar-a', 'ghost', 'jar-b'],
        allowUsedCupDropIfFull: false,
      allowDiscardRetainedJuice: false,
      }),
    })

    const basis = readPlanApplicationBasisState(storage)

    expect(basis.plannerSettings).toEqual({
      juiceJarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 2,
      allowUsedCupDropIfFull: false,
      allowDiscardRetainedJuice: false,
    })
    expect(storage.writes).toEqual([])
  })
})
