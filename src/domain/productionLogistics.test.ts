import { describe, expect, it } from 'vitest'
import type { InventoryState, PlannerSettings } from '../types'
import type { PreparationShortfall } from './preparationShortfall'
import type { MultiTripProductionJarFill } from './multiTripReplenishment'
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
    juiceJarCarryMode: 'auto',
    reservedJuiceJarSlots: 0,
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
        finishedStockSources: [],
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

function receiverTimeline(
  juiceUnitsToPrepare: number,
  physicalJarId = 'jar-1',
  receiver: MultiTripProductionJarFill['receiver'] = 'carried-jar',
): MultiTripProductionJarFill[] {
  const fills: MultiTripProductionJarFill[] = []
  let remaining = Math.max(0, Math.floor(juiceUnitsToPrepare))
  let tripNumber = 1

  while (remaining > 0) {
    const juiceUnits = Math.min(5, remaining)
    fills.push({
      physicalJarId,
      recipeId: 'recipe',
      recipeName: 'Recipe',
      beforeTripNumber: tripNumber,
      servings: juiceUnits * 2,
      servingsAfterFill: juiceUnits * 2,
      fillAction:
        tripNumber === 1
          ? 'initial-fill'
          : 'refill-same-type',
      previousRecipeId:
        tripNumber === 1 ? null : 'recipe',
      previousRecipeName:
        tripNumber === 1 ? null : 'Recipe',
      receiver,
    })
    remaining -= juiceUnits
    tripNumber += 1
  }

  return fills
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
      receiverTimeline(7),
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
    const handoffs = result.actions.filter(
      (action) => action.kind === 'handoff-finished',
    )
    expect(
      handoffs.every(
        (action) =>
          action.quantity <= 10 &&
          action.outputJarReceiver === 'carried-jar' &&
          action.outputPhysicalJarId === 'jar-1',
      ),
    ).toBe(true)
    expect(
      handoffs.map((action) => ({
        quantity: action.quantity,
        beforeSalesTripNumber: action.beforeSalesTripNumber,
        requiresCompletedSalesTrips:
          action.requiresCompletedSalesTrips,
      })),
    ).toEqual([
      {
        quantity: 10,
        beforeSalesTripNumber: 1,
        requiresCompletedSalesTrips: 0,
      },
      {
        quantity: 4,
        beforeSalesTripNumber: 2,
        requiresCompletedSalesTrips: 1,
      },
    ])
  })

  it('acquires missing raw ingredients just in time through backpack capacity', () => {
    const result = buildProductionLogisticsPlan(
      shortfall(['lemon', 'sugar'], 2),
      inventory(),
      settings(),
      receiverTimeline(2),
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
      receiverTimeline(2),
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
      settings(),
      receiverTimeline(1, 'jar-1', 'jar-rack'),
    )

    expect(result.feasible).toBe(true)
    const handoff = result.actions.find(
      (action) => action.kind === 'handoff-finished',
    )
    expect(handoff).toMatchObject({
      quantity: 2,
      outputJarReceiver: 'jar-rack',
      outputPhysicalJarId: 'jar-1',
      outputRecipeId: 'recipe',
      beforeSalesTripNumber: 1,
      requiresCompletedSalesTrips: 0,
      outputJarServingsAfterHandoff: 2,
    })
    expect(handoff?.snapshot).toMatchObject({
      carriedOutputJarSlots: 0,
      rackOutputJarSlots: 1,
      outputJarReceiverSlots: 1,
    })
  })

  it('does not use general shelf slots as juice-jar storage', () => {
    const result = buildProductionLogisticsPlan(
      shortfall(['lemon'], 1),
      inventory({
        ingredientUnits: { lemon: 1 },
        waterUnits: 1,
        shelfCount: 10,
        jarRackCount: 0,
      }),
      settings(),
      receiverTimeline(1, 'jar-1', 'jar-rack'),
    )

    expect(result.feasible).toBe(false)
    expect(result.initialSnapshot).toMatchObject({
      shelfSlotsAvailable: 90,
      carriedOutputJarSlots: 1,
      rackOutputJarSlots: 0,
      outputJarReceiverSlots: 1,
    })
    expect(result.issues.join(' ')).toContain(
      '需要放在果汁罐架，但目前沒有可用的果汁罐架格',
    )
    expect(
      result.actions.some((action) => action.kind === 'handoff-finished'),
    ).toBe(false)
  })

  it('does not treat empty jar-rack slots as physical jars', () => {
    const result = buildProductionLogisticsPlan(
      shortfall(['lemon'], 1),
      inventory({
        ingredientUnits: { lemon: 1 },
        waterUnits: 0,
        juiceJars: [],
        jarRackCount: 1,
      }),
      settings(),
      receiverTimeline(1),
    )

    expect(result.feasible).toBe(false)
    expect(result.issues.join(' ')).toContain(
      '成品接收罐 jar-1 不存在',
    )
    expect(result.waterFetchTrips).toBe(0)
    expect(
      result.actions.some((action) => action.kind === 'fetch-water'),
    ).toBe(false)
    expect(
      result.actions.some((action) => action.kind === 'handoff-finished'),
    ).toBe(false)
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
      settings({
        juiceJarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: 9,
      }),
      receiverTimeline(1),
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
      settings({
        juiceJarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: 10,
      }),
      receiverTimeline(1),
    )

    expect(result.feasible).toBe(false)
    expect(result.issues.join(' ')).toContain(
      '沒有可供架子 ↔ 機器搬運使用的暫時格',
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
      settings({
        juiceJarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: 9,
      }),
      receiverTimeline(1),
    )

    expect(result.feasible).toBe(false)
    expect(result.issues.join(' ')).toContain(
      '現有製作物資無法放入目前一般架',
    )
  })
})
