import { describe, expect, it } from 'vitest'
import type { InventoryState, PlannerSettings } from '../types'
import type { PreparationShortfall } from './preparationShortfall'
import {
  buildNetProductionPlan,
  buildProductionLogisticsPlan,
} from './productionLogistics'

function inventory(
  patch: Partial<InventoryState> = {},
): InventoryState {
  return {
    ingredientUnits: {},
    waterUnits: 0,
    cleanCups: 0,
    usedCups: 0,
    juiceJars: [
      {
        id: 'jar-1',
        recipeId: null,
        servings: 0,
      },
    ],
    shelfCount: 1,
    jarRackCount: 0,
    ...patch,
  }
}

function settings(
  patch: Partial<PlannerSettings> = {},
): PlannerSettings {
  return {
    carriedJuiceJarCount: 1,
    allowUsedCupDropIfFull: false,
    ...patch,
  }
}

function shortfall(
  ingredientIds: string[],
  juiceUnitsToPrepare: number,
  patch: Partial<PreparationShortfall> = {},
): PreparationShortfall {
  const counts = new Map<string, number>()
  for (const ingredientId of ingredientIds) {
    counts.set(ingredientId, (counts.get(ingredientId) ?? 0) + 1)
  }

  const ingredients = [...counts.entries()].map(
    ([ingredientId, perUnit]) => ({
      ingredientId,
      name: ingredientId,
      requiredUnits: perUnit * juiceUnitsToPrepare,
      inventoryUnitsAvailable: 0,
      inventoryUnitsUsed: 0,
      purchaseUnits: perUnit * juiceUnitsToPrepare,
    }),
  )

  return {
    recipes: [
      {
        recipeId: 'recipe',
        recipeName: 'Recipe',
        ingredientIds,
        assignedServings: juiceUnitsToPrepare * 2,
        finishedServingsAvailable: 0,
        finishedServingsUsed: 0,
        finishedServingsRemaining: 0,
        servingsToProduce: juiceUnitsToPrepare * 2,
        juiceUnitsToPrepare,
        newlyProducedServings: juiceUnitsToPrepare * 2,
        newProductionLeftoverServings: 0,
        ingredientUnitsPerJuiceUnit: [...counts.entries()].map(
          ([ingredientId, quantityPerJuiceUnit]) => ({
            ingredientId,
            quantityPerJuiceUnit,
          }),
        ),
      },
    ],
    ingredients,
    productionWaterUnitsRequired: juiceUnitsToPrepare,
    waterUnitsAvailable: 0,
    waterUnitsUsed: 0,
    waterUnitsToFetch: juiceUnitsToPrepare,
    cleanCupUses: juiceUnitsToPrepare * 2,
    cleanCupsAvailable: 0,
    cleanCupShortfallBeforeWashing: juiceUnitsToPrepare * 2,
    usedCupsAvailable: 0,
    ...patch,
  }
}

describe('production logistics', () => {
  it('rebuilds the production graph from stock-offset net units', () => {
    const plan = buildNetProductionPlan(
      shortfall(['lemon', 'sugar'], 1),
    )

    expect(plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'juice:lemon',
          quantity: 1,
        }),
        expect.objectContaining({
          key: 'season:lemon>sugar',
          quantity: 1,
        }),
        expect.objectContaining({
          key: 'finish:lemon>sugar',
          quantity: 1,
        }),
      ]),
    )
  })

  it('produces a feasible machine trace and fetches useful water in one trip', () => {
    const result = buildProductionLogisticsPlan(
      shortfall(['lemon'], 7),
      inventory({
        ingredientUnits: { lemon: 7 },
        shelfCount: 2,
      }),
      settings(),
    )

    expect(result.feasible).toBe(true)
    expect(result.waterFetchTrips).toBe(1)
    expect(
      result.actions.filter((action) => action.kind === 'fetch-water'),
    ).toEqual([
      expect.objectContaining({
        quantity: 7,
      }),
    ])
    expect(
      result.actions.filter((action) => action.kind === 'run-machine'),
    ).toHaveLength(result.productionPlan.machineOperations.total)
    expect(
      result.actions.some(
        (action) =>
          action.kind === 'load-machine' &&
          action.snapshot.machineSlotsUsed > 0,
      ),
    ).toBe(true)
    expect(
      result.actions
        .filter((action) => action.kind === 'handoff-finished')
        .every(
          (action) =>
            action.quantity <= 10 &&
            action.outputJarReceiver === 'carried-jar',
        ),
    ).toBe(true)
  })

  it('acquires missing raw ingredients just in time through backpack capacity', () => {
    const result = buildProductionLogisticsPlan(
      shortfall(['lemon', 'sugar'], 2),
      inventory(),
      settings(),
    )

    expect(result.feasible).toBe(true)
    expect(result.ingredientAcquisitionActions).toBe(2)
    expect(
      result.actions
        .filter((action) => action.kind === 'acquire-ingredient')
        .map((action) => action.quantity),
    ).toEqual([2, 2])
  })

  it('keeps Blender inputs and machine slots physical', () => {
    const result = buildProductionLogisticsPlan(
      shortfall(
        ['lemon', 'sugar', 'lemon', 'sugar'],
        2,
        {
          waterUnitsToFetch: 0,
          waterUnitsAvailable: 2,
          waterUnitsUsed: 2,
        },
      ),
      inventory({
        ingredientUnits: {
          lemon: 4,
          sugar: 4,
        },
        waterUnits: 2,
        shelfCount: 2,
      }),
      settings(),
    )

    expect(result.feasible).toBe(true)
    expect(result.productionPlan.machineOperations.blending).toBe(1)

    const blenderRun = result.actions.find(
      (action) =>
        action.kind === 'run-machine' &&
        action.equipment === '果汁調和器',
    )
    expect(blenderRun?.snapshot).toMatchObject({
      machineSlotsUsed: 1,
      machineSlotsAvailable: 3,
    })
  })

  it('uses a jar-rack staged physical jar as the finalizer receiver', () => {
    const result = buildProductionLogisticsPlan(
      shortfall(['lemon'], 1),
      inventory({
        ingredientUnits: { lemon: 1 },
        waterUnits: 1,
        jarRackCount: 1,
      }),
      settings({ carriedJuiceJarCount: 0 }),
    )

    expect(result.feasible).toBe(true)
    const handoff = result.actions.find(
      (action) => action.kind === 'handoff-finished',
    )
    expect(handoff).toMatchObject({
      quantity: 2,
      outputJarReceiver: 'jar-rack',
    })
    expect(handoff?.snapshot).toMatchObject({
      carriedOutputJarSlots: 0,
      rackOutputJarSlots: 1,
      outputJarReceiverSlots: 1,
    })
  })

  it('does not treat empty jar-rack slots as physical jars', () => {
    const result = buildProductionLogisticsPlan(
      shortfall(['lemon'], 1),
      inventory({
        ingredientUnits: { lemon: 1 },
        waterUnits: 1,
        juiceJars: [],
        jarRackCount: 1,
      }),
      settings({ carriedJuiceJarCount: 0 }),
    )

    expect(result.feasible).toBe(false)
    expect(result.issues.join(' ')).toContain(
      'finalizer output 沒有可接手的 physical juice jar',
    )
  })

  it('frees the last backpack slot by loading the first machine input before fetching water', () => {
    const jars = Array.from({ length: 9 }, (_, index) => ({
      id: `jar-${index + 1}`,
      recipeId: null,
      servings: 0,
    }))

    const result = buildProductionLogisticsPlan(
      shortfall(['lemon'], 1),
      inventory({
        ingredientUnits: { lemon: 1 },
        shelfCount: 0,
        juiceJars: jars,
      }),
      settings({ carriedJuiceJarCount: 9 }),
    )

    expect(result.feasible).toBe(true)
    expect(result.waterFetchTrips).toBe(1)
    const fetch = result.actions.find(
      (action) => action.kind === 'fetch-water',
    )
    expect(fetch?.snapshot).toMatchObject({
      backpackSlotsUsed: 1,
      backpackSlotsAvailable: 1,
      machineSlotsUsed: 1,
      machineSlotsAvailable: 3,
    })
  })

  it('rejects production when carried jars leave no transient backpack slot', () => {
    const jars = Array.from({ length: 10 }, (_, index) => ({
      id: `jar-${index + 1}`,
      recipeId: null,
      servings: 0,
    }))

    const result = buildProductionLogisticsPlan(
      shortfall(['lemon'], 1),
      inventory({
        ingredientUnits: { lemon: 1 },
        juiceJars: jars,
      }),
      settings({ carriedJuiceJarCount: 10 }),
    )

    expect(result.feasible).toBe(false)
    expect(result.issues.join(' ')).toContain(
      '沒有可供 shelf ↔ machine 搬運使用的暫時 slot',
    )
  })

  it('rejects an impossible initial production-material layout', () => {
    const result = buildProductionLogisticsPlan(
      shortfall(['lemon'], 1),
      inventory({
        ingredientUnits: {
          lemon: 5,
          sugar: 5,
        },
        shelfCount: 0,
        juiceJars: Array.from({ length: 9 }, (_, index) => ({
          id: `jar-${index + 1}`,
          recipeId: null,
          servings: 0,
        })),
      }),
      settings({ carriedJuiceJarCount: 9 }),
    )

    expect(result.feasible).toBe(false)
    expect(result.issues.join(' ')).toContain(
      '現有 production materials 無法放入目前一般架',
    )
  })
})
