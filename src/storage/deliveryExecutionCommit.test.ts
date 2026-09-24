import { describe, expect, it } from 'vitest'
import {
  createDeliveryExecutionCursor,
  type DeliveryExecutionPlan,
} from '../domain/deliveryExecution'
import type { InventoryState } from '../types'
import {
  INVENTORY_STORAGE_KEY,
  readInventoryState,
  writeInventoryState,
} from './inventoryState'
import {
  commitDeliveryExecutionCustomer,
  deliveryExecutionCanonicalBasisFingerprint,
} from './deliveryExecutionCommit'
import {
  PLAN_APPLICATION_STATE_STORAGE_KEY,
  readPlanApplicationStoredState,
} from './planApplicationState'
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

  constructor(initial: Record<string, string> = {}) {
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

function initialInventory(): InventoryState {
  return {
    ingredientUnits: {},
    intermediateJuiceUnits: {
      'juice-state:v1:lemon/mint': 2,
    },
    waterUnits: 0,
    cleanCups: 2,
    usedCups: 0,
    juiceJars: [
      {
        id: 'jar-a',
        recipeId: 'recipe-a',
        servings: 2,
      },
    ],
    shelfCount: 0,
    jarRackCount: 0,
  }
}

function planA(): DeliveryExecutionPlan {
  return {
    planFingerprint: 'delivery-plan-a',
    policy: 'retain-and-wash',
    trips: [
      {
        tripNumber: 1,
        productionFills: [],
        initialJuiceDiscards: [],
        ingredientRequirements: [],
        productionWaterUnits: 0,
        cupsWashedBeforeTrip: 0,
        cupWashWaterUnits: 0,
        cleanCupsBeforeTrip: 2,
        usedCupsBeforeTrip: 0,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 2,
        juiceJarSlotsCarried: 1,
        deliveries: [
          {
            customerId: 'customer-a',
            physicalJarId: 'jar-a',
            recipeId: 'recipe-a',
            recipeName: 'A',
          },
          {
            customerId: 'customer-b',
            physicalJarId: 'jar-a',
            recipeId: 'recipe-a',
            recipeName: 'A',
          },
        ],
        newProductionDiscards: [],
      },
    ],
    finalCleanCups: 0,
    finalUsedCups: 2,
    finalPhysicalCupCount: 2,
  }
}

function replannedAfterCustomerB(): DeliveryExecutionPlan {
  return {
    planFingerprint: 'delivery-plan-b',
    policy: 'retain-and-wash',
    trips: [
      {
        tripNumber: 1,
        productionFills: [],
        initialJuiceDiscards: [],
        ingredientRequirements: [],
        productionWaterUnits: 0,
        cupsWashedBeforeTrip: 0,
        cupWashWaterUnits: 0,
        cleanCupsBeforeTrip: 1,
        usedCupsBeforeTrip: 1,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 2,
        juiceJarSlotsCarried: 1,
        deliveries: [
          {
            customerId: 'customer-a',
            physicalJarId: 'jar-a',
            recipeId: 'recipe-a',
            recipeName: 'A',
          },
        ],
        newProductionDiscards: [],
      },
    ],
    finalCleanCups: 0,
    finalUsedCups: 2,
    finalPhysicalCupCount: 2,
  }
}

function legacyStorage(): MemoryStorage {
  return new MemoryStorage({
    [INVENTORY_STORAGE_KEY]: JSON.stringify(initialInventory()),
    [STORAGE_KEYS.suppliedToday]: JSON.stringify([
      'already-supplied',
    ]),
  })
}

function initialBasis() {
  return {
    inventory: initialInventory(),
    suppliedCustomerIds: ['already-supplied'],
  }
}

describe('partial delivery atomic commit', () => {
  it('includes intermediate juice stock in the canonical execution basis', () => {
    const base = initialInventory()
    const changed: InventoryState = {
      ...base,
      intermediateJuiceUnits: {
        'juice-state:v1:lemon/mint': 3,
      },
    }

    expect(
      deliveryExecutionCanonicalBasisFingerprint(base, []),
    ).not.toBe(
      deliveryExecutionCanonicalBasisFingerprint(changed, []),
    )
  })

  it('atomically writes inventory, supplied customers, and execution cursor once', () => {
    const storage = legacyStorage()
    const plan = planA()
    const cursor = createDeliveryExecutionCursor(plan)

    const result = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor,
        customerId: 'customer-b',
        expectedBasis: initialBasis(),
      },
      storage,
    )

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return

    expect(storage.writes).toHaveLength(1)
    expect(storage.writes[0]?.key).toBe(
      PLAN_APPLICATION_STATE_STORAGE_KEY,
    )
    expect(readInventoryState(storage)).toEqual(result.inventory)
    expect(readSuppliedCustomerIds(storage)).toEqual([
      'already-supplied',
      'customer-b',
    ])
    expect(result.inventory).toMatchObject({
      cleanCups: 1,
      usedCups: 1,
      juiceJars: [
        {
          id: 'jar-a',
          recipeId: 'recipe-a',
          servings: 1,
        },
      ],
    })

    const stored = readPlanApplicationStoredState(storage)
    expect(stored?.schemaVersion).toBe(
      'plan-application-state-v2',
    )
    expect(stored?.deliveryExecution?.cursor).toEqual(
      result.cursor,
    )
    expect(stored?.deliveryExecution?.cursor).toMatchObject({
      planFingerprint: 'delivery-plan-a',
      nextTripNumber: 1,
      tripPrepared: true,
      completedCustomerIdsInTrip: ['customer-b'],
    })
  })

  it('continues the same session only from the exact stored cursor and canonical basis', () => {
    const storage = legacyStorage()
    const plan = planA()
    const first = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: createDeliveryExecutionCursor(plan),
        customerId: 'customer-b',
        expectedBasis: initialBasis(),
      },
      storage,
    )
    expect(first.status).toBe('applied')
    if (first.status !== 'applied') return

    storage.writes = []
    const second = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: first.cursor,
        customerId: 'customer-a',
        expectedBasis: initialBasis(),
      },
      storage,
    )

    expect(second.status).toBe('applied')
    if (second.status !== 'applied') return

    expect(storage.writes).toHaveLength(1)
    expect(second.inventory).toMatchObject({
      cleanCups: 0,
      usedCups: 2,
      juiceJars: [
        {
          id: 'jar-a',
          recipeId: null,
          servings: 0,
        },
      ],
    })
    expect(second.suppliedCustomerIds).toEqual([
      'already-supplied',
      'customer-b',
      'customer-a',
    ])
    expect(second.cursor.nextTripNumber).toBe(2)
  })

  it('rejects raw canonical-state drift even when the stored cursor itself was preserved', () => {
    const storage = legacyStorage()
    const plan = planA()
    const first = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: createDeliveryExecutionCursor(plan),
        customerId: 'customer-b',
        expectedBasis: initialBasis(),
      },
      storage,
    )
    expect(first.status).toBe('applied')
    if (first.status !== 'applied') return

    const raw = storage.raw(PLAN_APPLICATION_STATE_STORAGE_KEY)
    expect(raw).not.toBeNull()
    const tampered = JSON.parse(raw!)
    tampered.inventory.waterUnits = 1
    storage.replaceRaw(
      PLAN_APPLICATION_STATE_STORAGE_KEY,
      JSON.stringify(tampered),
    )
    storage.writes = []

    const result = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: first.cursor,
        customerId: 'customer-a',
        expectedBasis: initialBasis(),
      },
      storage,
    )

    expect(result).toEqual({
      status: 'stale',
      mismatches: ['execution-basis'],
    })
    expect(storage.writes).toEqual([])
  })

  it('invalidates an in-flight cursor after a manual canonical inventory edit', () => {
    const storage = legacyStorage()
    const plan = planA()
    const first = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: createDeliveryExecutionCursor(plan),
        customerId: 'customer-b',
        expectedBasis: initialBasis(),
      },
      storage,
    )
    expect(first.status).toBe('applied')
    if (first.status !== 'applied') return

    writeInventoryState(storage, {
      ...first.inventory,
      waterUnits: 1,
    })
    expect(
      readPlanApplicationStoredState(storage)?.deliveryExecution,
    ).toBeNull()

    storage.writes = []
    const result = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: first.cursor,
        customerId: 'customer-a',
        expectedBasis: {
          inventory: readInventoryState(storage),
          suppliedCustomerIds:
            readSuppliedCustomerIds(storage),
        },
      },
      storage,
    )

    expect(result).toEqual({
      status: 'stale',
      mismatches: ['execution-cursor'],
    })
    expect(storage.writes).toEqual([])
  })

  it('invalidates an in-flight cursor after a manual supplied-customer edit', () => {
    const storage = legacyStorage()
    const plan = planA()
    const first = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: createDeliveryExecutionCursor(plan),
        customerId: 'customer-b',
        expectedBasis: initialBasis(),
      },
      storage,
    )
    expect(first.status).toBe('applied')
    if (first.status !== 'applied') return

    writeSuppliedCustomerIds(storage, [
      ...first.suppliedCustomerIds,
      'manual-customer',
    ])
    expect(
      readPlanApplicationStoredState(storage)?.deliveryExecution,
    ).toBeNull()

    storage.writes = []
    const result = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: first.cursor,
        customerId: 'customer-a',
        expectedBasis: {
          inventory: readInventoryState(storage),
          suppliedCustomerIds:
            readSuppliedCustomerIds(storage),
        },
      },
      storage,
    )

    expect(result).toEqual({
      status: 'stale',
      mismatches: ['execution-cursor'],
    })
    expect(storage.writes).toEqual([])
  })

  it('rejects an old or reconstructed cursor inside the same active plan', () => {
    const storage = legacyStorage()
    const plan = planA()
    const first = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: createDeliveryExecutionCursor(plan),
        customerId: 'customer-b',
        expectedBasis: initialBasis(),
      },
      storage,
    )
    expect(first.status).toBe('applied')
    if (first.status !== 'applied') return

    storage.writes = []
    const result = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: createDeliveryExecutionCursor(plan),
        customerId: 'customer-a',
        expectedBasis: initialBasis(),
      },
      storage,
    )

    expect(result).toEqual({
      status: 'stale',
      mismatches: ['execution-cursor'],
    })
    expect(storage.writes).toEqual([])
  })

  it('allows a newly solved plan to take over from the exact current partial-delivery state', () => {
    const storage = legacyStorage()
    const oldPlan = planA()
    const first = commitDeliveryExecutionCustomer(
      {
        plan: oldPlan,
        cursor: createDeliveryExecutionCursor(oldPlan),
        customerId: 'customer-b',
        expectedBasis: initialBasis(),
      },
      storage,
    )
    expect(first.status).toBe('applied')
    if (first.status !== 'applied') return

    const newPlan = replannedAfterCustomerB()
    const currentBasis = {
      inventory: readInventoryState(storage),
      suppliedCustomerIds: readSuppliedCustomerIds(storage),
    }
    storage.writes = []

    const result = commitDeliveryExecutionCustomer(
      {
        plan: newPlan,
        cursor: createDeliveryExecutionCursor(newPlan),
        customerId: 'customer-a',
        expectedBasis: currentBasis,
      },
      storage,
    )

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return

    expect(storage.writes).toHaveLength(1)
    expect(result.suppliedCustomerIds).toEqual([
      'already-supplied',
      'customer-b',
      'customer-a',
    ])
    expect(
      readPlanApplicationStoredState(storage)
        ?.deliveryExecution?.cursor.planFingerprint,
    ).toBe('delivery-plan-b')
  })

  it('upgrades an existing v1 canonical envelope on the first partial commit', () => {
    const storage = new MemoryStorage({
      [PLAN_APPLICATION_STATE_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 'plan-application-state-v1',
        inventory: initialInventory(),
        suppliedCustomerIds: ['already-supplied'],
      }),
    })
    const plan = planA()

    const result = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: createDeliveryExecutionCursor(plan),
        customerId: 'customer-a',
        expectedBasis: initialBasis(),
      },
      storage,
    )

    expect(result.status).toBe('applied')
    expect(storage.writes).toHaveLength(1)
    expect(
      JSON.parse(
        storage.raw(PLAN_APPLICATION_STATE_STORAGE_KEY)!,
      ).schemaVersion,
    ).toBe('plan-application-state-v2')
  })

  it('does not partially update legacy state when the canonical write fails', () => {
    const storage = legacyStorage()
    const beforeInventory = storage.raw(INVENTORY_STORAGE_KEY)
    const beforeSupplied = storage.raw(STORAGE_KEYS.suppliedToday)
    storage.failOnWriteKey = PLAN_APPLICATION_STATE_STORAGE_KEY
    const plan = planA()

    const result = commitDeliveryExecutionCustomer(
      {
        plan,
        cursor: createDeliveryExecutionCursor(plan),
        customerId: 'customer-a',
        expectedBasis: initialBasis(),
      },
      storage,
    )

    expect(result).toEqual({
      status: 'error',
      message: 'simulated storage failure',
    })
    expect(storage.writes).toEqual([])
    expect(storage.raw(PLAN_APPLICATION_STATE_STORAGE_KEY)).toBeNull()
    expect(storage.raw(INVENTORY_STORAGE_KEY)).toBe(beforeInventory)
    expect(storage.raw(STORAGE_KEYS.suppliedToday)).toBe(beforeSupplied)
  })
})
