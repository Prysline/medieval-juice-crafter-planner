import { describe, expect, it } from 'vitest'
import type { InventoryState, PlannerSettings } from '../types'
import type { OptimizationResult } from './optimizer'
import type { PreparationShortfall } from './preparationShortfall'
import type { ProductionLogisticsPlan } from './productionLogistics'
import type { MultiTripReplenishmentPlan } from './multiTripReplenishment'
import {
  applyDeliveryExecutionCustomer,
  buildDeliveryExecutionPlan,
  buildCanonicalDeliveryTransaction,
  createDeliveryExecutionCursor,
  type DeliveryExecutionPlan,
} from './deliveryExecution'
import {
  buildPlanApplicationTransactionDraft,
  type PlanApplicationBasisState,
} from './planApplicationTransaction'

function inventory(): InventoryState {
  return {
    ingredientUnits: { sugar: 1 },
    intermediateJuiceUnits: {
      'juice-state:v1:lemon/mint': 3,
    },
    waterUnits: 2,
    cleanCups: 1,
    usedCups: 1,
    juiceJars: [
      {
        id: 'jar-a',
        recipeId: 'recipe-a',
        servings: 1,
      },
      {
        id: 'jar-b',
        recipeId: null,
        servings: 0,
      },
    ],
    shelfCount: 1,
    jarRackCount: 0,
  }
}

function shortfall(): PreparationShortfall {
  return {
    recipes: [
      {
        recipeId: 'recipe-a',
        recipeName: 'A',
        ingredientIds: ['lemon'],
        assignedServings: 1,
        finishedServingsAvailable: 1,
        finishedServingsUsed: 1,
        finishedServingsRemaining: 0,
        finishedStockSources: [
          {
            physicalJarId: 'jar-a',
            recipeId: 'recipe-a',
            initialServings: 1,
            servingsUsed: 1,
            servingsRemaining: 0,
          },
        ],
        servingsToProduce: 0,
        juiceUnitsToPrepare: 0,
        newlyProducedServings: 0,
        newProductionLeftoverServings: 0,
        ingredientUnitsPerJuiceUnit: [
          { ingredientId: 'lemon', quantityPerJuiceUnit: 1 },
        ],
      },
      {
        recipeId: 'recipe-b',
        recipeName: 'B',
        ingredientIds: ['sugar'],
        assignedServings: 1,
        finishedServingsAvailable: 0,
        finishedServingsUsed: 0,
        finishedServingsRemaining: 0,
        finishedStockSources: [],
        servingsToProduce: 1,
        juiceUnitsToPrepare: 1,
        newlyProducedServings: 2,
        newProductionLeftoverServings: 1,
        ingredientUnitsPerJuiceUnit: [
          { ingredientId: 'sugar', quantityPerJuiceUnit: 1 },
        ],
      },
    ],
    ingredients: [
      {
        ingredientId: 'sugar',
        name: '糖',
        requiredUnits: 1,
        inventoryUnitsAvailable: 1,
        inventoryUnitsUsed: 1,
        purchaseUnits: 0,
      },
    ],
    productionWaterUnitsRequired: 1,
    waterUnitsAvailable: 2,
    waterUnitsUsed: 1,
    waterUnitsToFetch: 0,
    cleanCupUses: 2,
    cleanCupsAvailable: 1,
    cleanCupShortfallBeforeWashing: 1,
    usedCupsAvailable: 1,
  }
}

function salesPlan(): MultiTripReplenishmentPlan {
  return {
    policy: 'retain-and-wash',
    jarCarryMode: 'fixed-slots',
    reservedJuiceJarSlots: 2,
    minimumCarriedJuiceJarSlots: 2,
    carriedJuiceJarCount: 2,
    carriedJuiceJars: [
      {
        physicalJarId: 'jar-a',
        initialRecipeId: 'recipe-a',
        initialServings: 1,
      },
      {
        physicalJarId: 'jar-b',
        initialRecipeId: null,
        initialServings: 0,
      },
    ],
    physicalJarsUsed: 2,
    totalJarLoads: 2,
    distinctFinalJuiceTypes: 2,
    jarTypeSwitches: 0,
    trips: [
      {
        tripNumber: 1,
        juiceJars: [
          {
            physicalJarId: 'jar-a',
            recipeId: 'recipe-a',
            recipeName: 'A',
            customerIds: ['customer-a'],
            servings: 1,
            retainedLeftoverServings: 0,
            plannedFillServings: 0,
            slotCost: 1,
            fillAction: 'use-existing',
            previousRecipeId: 'recipe-a',
            previousRecipeName: 'A',
          },
          {
            physicalJarId: 'jar-b',
            recipeId: 'recipe-b',
            recipeName: 'B',
            customerIds: ['customer-b'],
            servings: 1,
            retainedLeftoverServings: 1,
            plannedFillServings: 2,
            slotCost: 1,
            fillAction: 'initial-fill',
            previousRecipeId: null,
            previousRecipeName: null,
          },
        ],
        carriedPhysicalJarIds: ['jar-a', 'jar-b'],
        totalServings: 2,
        cleanCupStacks: 1,
        cleanCupsCarried: 2,
        departureSlots: 3,
        effectiveDepartureSlotLimit: 10,
        spareDepartureSlots: 7,
        reservedTransientUsedCupSlot: 1,
        usedCupDropMayOccur: false,
        droppedUsedCups: 0,
        cupsWashedBeforeTrip: 1,
        cupWashWaterUnits: 1,
        cleanCupsBeforeTrip: 1,
        usedCupsBeforeTrip: 1,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 2,
        physicalCupsAfterTrip: 2,
        peakCupSlots: 2,
        peakOccupiedSlots: 4,
        juiceJarSlotsCarried: 2,
      },
    ],
    tripCount: 1,
    totalAssignedServings: 2,
    totalLeftoverServings: 1,
    leftoverJarContents: [
      {
        physicalJarId: 'jar-b',
        recipeId: 'recipe-b',
        recipeName: 'B',
        servings: 1,
        tripNumber: 1,
      },
    ],
    productionJarFills: [
      {
        physicalJarId: 'jar-b',
        recipeId: 'recipe-b',
        recipeName: 'B',
        beforeTripNumber: 1,
        servings: 2,
        servingsAfterFill: 2,
        fillAction: 'initial-fill',
        previousRecipeId: null,
        previousRecipeName: null,
        receiver: 'carried-jar',
      },
    ],
    allowDiscardRetainedJuice: false,
    discardedInitialJuice: [],
    discardedNewProductionJuice: [],
    maxJuiceJarSlotsCarried: 2,
    cleanCupUnitsRequiredWithoutMiddayWashing: 2,
    reusableCleanCupPoolSize: 2,
    initialCleanCups: 1,
    initialUsedCups: 1,
    initialPhysicalCupCount: 2,
    finalCleanCups: 0,
    finalUsedCups: 2,
    finalPhysicalCupCount: 2,
    droppedUsedCups: 0,
    initialWashWaterUnits: 1,
    betweenTripWashWaterUnits: 0,
    totalCupWashWaterUnits: 1,
    returnsHomeBetweenTrips: false,
  }
}

function settings(): PlannerSettings {
  return {
    juiceJarCarryMode: 'fixed-slots',
    reservedJuiceJarSlots: 2,
    allowUsedCupDropIfFull: false,
    allowDiscardRetainedJuice: false,
  }
}

function basis(): PlanApplicationBasisState {
  return {
    inventory: inventory(),
    currentProgress: 'juice-jar-unlocked',
    satisfactionByVillage: {
      'east-harbor': 0,
      'tranquil-fountain': 0,
    },
    formalCustomerIds: ['customer-a', 'customer-b'],
    suppliedCustomerIds: [],
    plannerSettings: settings(),
  }
}

function optimizationResult(): OptimizationResult {
  return {
    assignments: [
      { customerId: 'customer-a', recipeId: 'recipe-a' },
      { customerId: 'customer-b', recipeId: 'recipe-b' },
    ],
    recipePlans: [
      {
        recipeId: 'recipe-a',
        recipeName: 'A',
        customerIds: ['customer-a'],
        juiceUnits: 1,
        producedServings: 2,
        assignedServings: 1,
        leftoverServings: 1,
        ingredientIds: ['lemon'],
        juiceUnitIngredientCost: 1,
        totalIngredientCost: 1,
      },
      {
        recipeId: 'recipe-b',
        recipeName: 'B',
        customerIds: ['customer-b'],
        juiceUnits: 1,
        producedServings: 2,
        assignedServings: 1,
        leftoverServings: 1,
        ingredientIds: ['sugar'],
        juiceUnitIngredientCost: 1,
        totalIngredientCost: 1,
      },
    ],
    productionSteps: [],
    machineOperations: {
      total: 0,
      juicing: 0,
      seasoning: 0,
      blending: 0,
      finalizing: 0,
    },
    jarTypeSwitches: 0,
    availableJuiceJarCount: 2,
    shoppingList: [],
    unresolvedCustomers: [],
    totalIngredientCost: 2,
    knownSalesRevenue: 0,
    knownGrossProfit: 0,
    formalSalesCount: 2,
    potentialTrialCount: 0,
    unknownFormalSalePriceCount: 2,
    producedServings: 4,
    assignedServings: 2,
    leftoverServings: 2,
  }
}

function logistics(): ProductionLogisticsPlan {
  const snapshot = {
    shelfSlotsUsed: 0,
    shelfSlotsAvailable: 9,
    backpackSlotsUsed: 0,
    backpackSlotsAvailable: 8,
    carriedJarSlots: 2,
    outputJarReceiverSlots: 2,
    carriedOutputJarSlots: 2,
    rackOutputJarSlots: 0,
    machineSlotsUsed: 0,
    machineSlotsAvailable: 0,
  }
  return {
    feasible: true,
    issues: [],
    productionPlan: {
      steps: [],
      machineOperations: {
        total: 0,
        juicing: 0,
        seasoning: 0,
        blending: 0,
        finalizing: 0,
      },
    },
    actions: [],
    ingredientAcquisitionActions: 0,
    waterFetchTrips: 0,
    initialSnapshot: snapshot,
    finalSnapshot: snapshot,
  }
}

function twoTripShortfall(): PreparationShortfall {
  return {
    recipes: ['recipe-b', 'recipe-c'].map((recipeId) => ({
      recipeId,
      recipeName: recipeId === 'recipe-b' ? 'B' : 'C',
      ingredientIds: ['lemon'],
      assignedServings: 1,
      finishedServingsAvailable: 0,
      finishedServingsUsed: 0,
      finishedServingsRemaining: 0,
      finishedStockSources: [],
      servingsToProduce: 1,
      juiceUnitsToPrepare: 1,
      newlyProducedServings: 2,
      newProductionLeftoverServings: 1,
      ingredientUnitsPerJuiceUnit: [
        { ingredientId: 'lemon', quantityPerJuiceUnit: 1 },
      ],
    })),
    ingredients: [
      {
        ingredientId: 'lemon',
        name: '檸檬',
        requiredUnits: 2,
        inventoryUnitsAvailable: 2,
        inventoryUnitsUsed: 2,
        purchaseUnits: 0,
      },
    ],
    productionWaterUnitsRequired: 2,
    waterUnitsAvailable: 3,
    waterUnitsUsed: 2,
    waterUnitsToFetch: 0,
    cleanCupUses: 2,
    cleanCupsAvailable: 1,
    cleanCupShortfallBeforeWashing: 1,
    usedCupsAvailable: 0,
  }
}

function twoTripPlan(): MultiTripReplenishmentPlan {
  return {
    policy: 'retain-and-wash',
    jarCarryMode: 'fixed-slots',
    reservedJuiceJarSlots: 1,
    minimumCarriedJuiceJarSlots: 1,
    carriedJuiceJarCount: 1,
    carriedJuiceJars: [
      {
        physicalJarId: 'jar-1',
        initialRecipeId: null,
        initialServings: 0,
      },
    ],
    physicalJarsUsed: 1,
    totalJarLoads: 2,
    distinctFinalJuiceTypes: 2,
    jarTypeSwitches: 1,
    trips: [
      {
        tripNumber: 1,
        juiceJars: [
          {
            physicalJarId: 'jar-1',
            recipeId: 'recipe-b',
            recipeName: 'B',
            customerIds: ['customer-1'],
            servings: 1,
            retainedLeftoverServings: 0,
            plannedFillServings: 2,
            slotCost: 1,
            fillAction: 'initial-fill',
            previousRecipeId: null,
            previousRecipeName: null,
          },
        ],
        carriedPhysicalJarIds: ['jar-1'],
        totalServings: 1,
        cleanCupStacks: 1,
        cleanCupsCarried: 1,
        departureSlots: 2,
        effectiveDepartureSlotLimit: 10,
        spareDepartureSlots: 8,
        reservedTransientUsedCupSlot: 0,
        usedCupDropMayOccur: false,
        droppedUsedCups: 0,
        cupsWashedBeforeTrip: 0,
        cupWashWaterUnits: 0,
        cleanCupsBeforeTrip: 1,
        usedCupsBeforeTrip: 0,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 1,
        physicalCupsAfterTrip: 1,
        peakCupSlots: 1,
        peakOccupiedSlots: 2,
        juiceJarSlotsCarried: 1,
      },
      {
        tripNumber: 2,
        juiceJars: [
          {
            physicalJarId: 'jar-1',
            recipeId: 'recipe-c',
            recipeName: 'C',
            customerIds: ['customer-2'],
            servings: 1,
            retainedLeftoverServings: 1,
            plannedFillServings: 2,
            slotCost: 1,
            fillAction: 'type-switch',
            previousRecipeId: 'recipe-b',
            previousRecipeName: 'B',
          },
        ],
        carriedPhysicalJarIds: ['jar-1'],
        totalServings: 1,
        cleanCupStacks: 1,
        cleanCupsCarried: 1,
        departureSlots: 2,
        effectiveDepartureSlotLimit: 10,
        spareDepartureSlots: 8,
        reservedTransientUsedCupSlot: 0,
        usedCupDropMayOccur: false,
        droppedUsedCups: 0,
        cupsWashedBeforeTrip: 1,
        cupWashWaterUnits: 1,
        cleanCupsBeforeTrip: 0,
        usedCupsBeforeTrip: 1,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 1,
        physicalCupsAfterTrip: 1,
        peakCupSlots: 1,
        peakOccupiedSlots: 2,
        juiceJarSlotsCarried: 1,
      },
    ],
    tripCount: 2,
    totalAssignedServings: 2,
    totalLeftoverServings: 1,
    leftoverJarContents: [
      {
        physicalJarId: 'jar-1',
        recipeId: 'recipe-c',
        recipeName: 'C',
        servings: 1,
        tripNumber: 2,
      },
    ],
    productionJarFills: [
      {
        physicalJarId: 'jar-1',
        recipeId: 'recipe-b',
        recipeName: 'B',
        beforeTripNumber: 1,
        servings: 2,
        servingsAfterFill: 2,
        fillAction: 'initial-fill',
        previousRecipeId: null,
        previousRecipeName: null,
        receiver: 'carried-jar',
      },
      {
        physicalJarId: 'jar-1',
        recipeId: 'recipe-c',
        recipeName: 'C',
        beforeTripNumber: 2,
        servings: 2,
        servingsAfterFill: 2,
        fillAction: 'type-switch',
        previousRecipeId: 'recipe-b',
        previousRecipeName: 'B',
        receiver: 'carried-jar',
      },
    ],
    allowDiscardRetainedJuice: true,
    discardedInitialJuice: [],
    discardedNewProductionJuice: [
      {
        physicalJarId: 'jar-1',
        recipeId: 'recipe-b',
        recipeName: 'B',
        servings: 1,
        afterTripNumber: 1,
      },
    ],
    maxJuiceJarSlotsCarried: 1,
    cleanCupUnitsRequiredWithoutMiddayWashing: 2,
    reusableCleanCupPoolSize: 1,
    initialCleanCups: 1,
    initialUsedCups: 0,
    initialPhysicalCupCount: 1,
    finalCleanCups: 0,
    finalUsedCups: 1,
    finalPhysicalCupCount: 1,
    droppedUsedCups: 0,
    initialWashWaterUnits: 0,
    betweenTripWashWaterUnits: 1,
    totalCupWashWaterUnits: 1,
    returnsHomeBetweenTrips: true,
  }
}

describe('canonical delivery preparation provenance', () => {
  it('keeps ingredient, intermediate, and water requirements scoped to each physical fill', () => {
    const plan = buildDeliveryExecutionPlan(shortfall(), salesPlan())
    const trip = plan.trips[0]

    expect(trip?.preparationLoads).toEqual([
      {
        physicalJarId: 'jar-b',
        recipeId: 'recipe-b',
        recipeName: 'B',
        plannedTripNumber: 1,
        fill: expect.objectContaining({
          physicalJarId: 'jar-b',
          recipeId: 'recipe-b',
          servings: 2,
        }),
        ingredientRequirements: [
          { ingredientId: 'sugar', units: 1 },
        ],
        intermediateRequirements: [],
        productionWaterUnits: 1,
      },
    ])

    const draft = buildCanonicalDeliveryTransaction(
      plan,
      inventory(),
      [],
      'customer-b',
    )
    expect(draft.status).toBe('needs-preparation')
    if (draft.status !== 'needs-preparation') return
    expect(draft.preparation).toEqual(
      trip?.preparationLoads?.[0],
    )
    expect(draft.events).toEqual({
      initialJuiceDiscards: [],
      ingredientRequirements: [
        { ingredientId: 'sugar', units: 1 },
      ],
      intermediateRequirements: [],
      productionWaterUnits: 1,
      productionFill: expect.objectContaining({
        physicalJarId: 'jar-b',
        recipeId: 'recipe-b',
        servings: 2,
      }),
    })
  })
})

describe('delivery execution trace', () => {
  it('materializes trip preparation once and allows arbitrary customer order inside the active trip', () => {
    const plan = buildDeliveryExecutionPlan(shortfall(), salesPlan())
    let cursor = createDeliveryExecutionCursor(plan)

    const first = applyDeliveryExecutionCustomer(
      plan,
      inventory(),
      cursor,
      'customer-b',
    )
    cursor = first.cursor

    expect(first.changes.tripPreparedNow).toBe(true)
    expect(first.changes.ingredients).toEqual([
      {
        ingredientId: 'sugar',
        requiredUnits: 1,
        consumedFromInventory: 1,
        externalUnitsRequired: 0,
      },
    ])
    expect(first.changes.water).toEqual({
      requiredUnits: 2,
      productionUnitsRequired: 1,
      cupWashUnitsRequired: 1,
      consumedFromInventory: 2,
      externalUnitsRequired: 0,
    })
    expect(first.inventory).toMatchObject({
      ingredientUnits: {},
      intermediateJuiceUnits: {
        'juice-state:v1:lemon/mint': 3,
      },
      waterUnits: 0,
      cleanCups: 1,
      usedCups: 1,
    })
    expect(first.inventory.juiceJars).toEqual([
      {
        id: 'jar-a',
        recipeId: 'recipe-a',
        servings: 1,
      },
      {
        id: 'jar-b',
        recipeId: 'recipe-b',
        servings: 1,
      },
    ])
    expect(cursor).toMatchObject({
      nextTripNumber: 1,
      tripPrepared: true,
      completedCustomerIdsInTrip: ['customer-b'],
    })

    const second = applyDeliveryExecutionCustomer(
      plan,
      first.inventory,
      cursor,
      'customer-a',
    )

    expect(second.changes.tripPreparedNow).toBe(false)
    expect(second.changes.tripCompleted).toBe(true)
    expect(second.inventory).toMatchObject({
      ingredientUnits: {},
      waterUnits: 0,
      cleanCups: 0,
      usedCups: 2,
    })
    expect(second.inventory.juiceJars).toEqual([
      {
        id: 'jar-a',
        recipeId: null,
        servings: 0,
      },
      {
        id: 'jar-b',
        recipeId: 'recipe-b',
        servings: 1,
      },
    ])
  })

  it('reaches the same final inventory as the existing whole-plan transaction', () => {
    const plan = buildDeliveryExecutionPlan(shortfall(), salesPlan())
    let cursor = createDeliveryExecutionCursor(plan)
    let current = inventory()

    for (const customerId of ['customer-b', 'customer-a']) {
      const result = applyDeliveryExecutionCustomer(
        plan,
        current,
        cursor,
        customerId,
      )
      current = result.inventory
      cursor = result.cursor
    }

    const fullDraft = buildPlanApplicationTransactionDraft({
      basis: basis(),
      result: optimizationResult(),
      preparationShortfall: shortfall(),
      productionLogistics: logistics(),
      salesPlan: salesPlan(),
    })

    expect(current).toEqual(fullDraft.after.inventory)
  })

  it('requires trip order, applies trip-end discard before jar reuse, and prepares the next trip only once', () => {
    const plan = buildDeliveryExecutionPlan(
      twoTripShortfall(),
      twoTripPlan(),
    )
    const startInventory: InventoryState = {
      ingredientUnits: { lemon: 2 },
      waterUnits: 3,
      cleanCups: 1,
      usedCups: 0,
      juiceJars: [
        { id: 'jar-1', recipeId: null, servings: 0 },
      ],
      shelfCount: 0,
      jarRackCount: 0,
    }
    let cursor = createDeliveryExecutionCursor(plan)

    expect(() =>
      applyDeliveryExecutionCustomer(
        plan,
        startInventory,
        cursor,
        'customer-2',
      ),
    ).toThrow(
      'Customer customer-2 belongs to later trip 2; complete trip 1 first',
    )

    const first = applyDeliveryExecutionCustomer(
      plan,
      startInventory,
      cursor,
      'customer-1',
    )
    cursor = first.cursor

    expect(first.changes.tripCompleted).toBe(true)
    expect(first.changes.newProductionDiscards).toHaveLength(1)
    expect(first.inventory.juiceJars[0]).toEqual({
      id: 'jar-1',
      recipeId: null,
      servings: 0,
    })
    expect(cursor.nextTripNumber).toBe(2)
    expect(first.inventory).toMatchObject({
      ingredientUnits: { lemon: 1 },
      waterUnits: 2,
      cleanCups: 0,
      usedCups: 1,
    })

    const second = applyDeliveryExecutionCustomer(
      plan,
      first.inventory,
      cursor,
      'customer-2',
    )

    expect(second.changes.tripPreparedNow).toBe(true)
    expect(second.changes.water).toMatchObject({
      productionUnitsRequired: 1,
      cupWashUnitsRequired: 1,
      requiredUnits: 2,
    })
    expect(second.inventory).toMatchObject({
      ingredientUnits: {},
      waterUnits: 0,
      cleanCups: 0,
      usedCups: 1,
    })
    expect(second.inventory.juiceJars[0]).toEqual({
      id: 'jar-1',
      recipeId: 'recipe-c',
      servings: 1,
    })
    expect(second.cursor.nextTripNumber).toBe(3)
  })

  it('allows a same-type refill after the previous trip emptied that jar', () => {
    const refillShortfall: PreparationShortfall = {
      ...twoTripShortfall(),
      recipes: [
        {
          recipeId: 'recipe-b',
          recipeName: 'B',
          ingredientIds: ['lemon'],
          assignedServings: 2,
          finishedServingsAvailable: 0,
          finishedServingsUsed: 0,
          finishedServingsRemaining: 0,
          finishedStockSources: [],
          servingsToProduce: 2,
          juiceUnitsToPrepare: 2,
          newlyProducedServings: 4,
          newProductionLeftoverServings: 2,
          ingredientUnitsPerJuiceUnit: [
            {
              ingredientId: 'lemon',
              quantityPerJuiceUnit: 1,
            },
          ],
        },
      ],
    }
    const refillPlan = twoTripPlan()
    refillPlan.distinctFinalJuiceTypes = 1
    refillPlan.jarTypeSwitches = 0
    refillPlan.trips[1].juiceJars[0] = {
      ...refillPlan.trips[1].juiceJars[0],
      recipeId: 'recipe-b',
      recipeName: 'B',
      fillAction: 'refill-same-type',
      previousRecipeId: 'recipe-b',
      previousRecipeName: 'B',
    }
    refillPlan.productionJarFills[1] = {
      ...refillPlan.productionJarFills[1],
      recipeId: 'recipe-b',
      recipeName: 'B',
      fillAction: 'refill-same-type',
      previousRecipeId: 'recipe-b',
      previousRecipeName: 'B',
    }
    refillPlan.leftoverJarContents[0] = {
      ...refillPlan.leftoverJarContents[0],
      recipeId: 'recipe-b',
      recipeName: 'B',
    }

    const plan = buildDeliveryExecutionPlan(
      refillShortfall,
      refillPlan,
    )
    let current: InventoryState = {
      ingredientUnits: { lemon: 2 },
      waterUnits: 3,
      cleanCups: 1,
      usedCups: 0,
      juiceJars: [
        { id: 'jar-1', recipeId: null, servings: 0 },
      ],
      shelfCount: 0,
      jarRackCount: 0,
    }
    let cursor = createDeliveryExecutionCursor(plan)

    const first = applyDeliveryExecutionCustomer(
      plan,
      current,
      cursor,
      'customer-1',
    )
    current = first.inventory
    cursor = first.cursor

    expect(current.juiceJars[0]).toEqual({
      id: 'jar-1',
      recipeId: null,
      servings: 0,
    })

    const second = applyDeliveryExecutionCustomer(
      plan,
      current,
      cursor,
      'customer-2',
    )

    expect(second.changes.productionFills[0]?.fillAction).toBe(
      'refill-same-type',
    )
    expect(second.inventory.juiceJars[0]).toEqual({
      id: 'jar-1',
      recipeId: 'recipe-b',
      servings: 1,
    })
  })

  it('reproduces per-customer used-cup drop behavior from the trip capacity state', () => {
    const dropShortfall: PreparationShortfall = {
      recipes: [
        {
          recipeId: 'recipe-a',
          recipeName: 'A',
          ingredientIds: ['lemon'],
          assignedServings: 2,
          finishedServingsAvailable: 2,
          finishedServingsUsed: 2,
          finishedServingsRemaining: 0,
          finishedStockSources: [
            {
              physicalJarId: 'jar-1',
              recipeId: 'recipe-a',
              initialServings: 2,
              servingsUsed: 2,
              servingsRemaining: 0,
            },
          ],
          servingsToProduce: 0,
          juiceUnitsToPrepare: 0,
          newlyProducedServings: 0,
          newProductionLeftoverServings: 0,
          ingredientUnitsPerJuiceUnit: [
            { ingredientId: 'lemon', quantityPerJuiceUnit: 1 },
          ],
        },
      ],
      ingredients: [],
      productionWaterUnitsRequired: 0,
      waterUnitsAvailable: 0,
      waterUnitsUsed: 0,
      waterUnitsToFetch: 0,
      cleanCupUses: 2,
      cleanCupsAvailable: 2,
      cleanCupShortfallBeforeWashing: 0,
      usedCupsAvailable: 0,
    }
    const carried = Array.from({ length: 9 }, (_, index) => ({
      physicalJarId: `jar-${index + 1}`,
      initialRecipeId: index === 0 ? 'recipe-a' : null,
      initialServings: index === 0 ? 2 : 0,
    }))
    const dropPlan: MultiTripReplenishmentPlan = {
      policy: 'allow-drop-if-full',
      jarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 9,
      minimumCarriedJuiceJarSlots: 9,
      carriedJuiceJarCount: 9,
      carriedJuiceJars: carried,
      physicalJarsUsed: 1,
      totalJarLoads: 1,
      distinctFinalJuiceTypes: 1,
      jarTypeSwitches: 0,
      trips: [
        {
          tripNumber: 1,
          juiceJars: [
            {
              physicalJarId: 'jar-1',
              recipeId: 'recipe-a',
              recipeName: 'A',
              customerIds: ['customer-1', 'customer-2'],
              servings: 2,
              retainedLeftoverServings: 0,
              plannedFillServings: 0,
              slotCost: 1,
              fillAction: 'use-existing',
              previousRecipeId: 'recipe-a',
              previousRecipeName: 'A',
            },
          ],
          carriedPhysicalJarIds: carried.map(
            (jar) => jar.physicalJarId,
          ),
          totalServings: 2,
          cleanCupStacks: 1,
          cleanCupsCarried: 2,
          departureSlots: 10,
          effectiveDepartureSlotLimit: 10,
          spareDepartureSlots: 0,
          reservedTransientUsedCupSlot: 0,
          usedCupDropMayOccur: true,
          droppedUsedCups: 1,
          cupsWashedBeforeTrip: 0,
          cupWashWaterUnits: 0,
          cleanCupsBeforeTrip: 2,
          usedCupsBeforeTrip: 0,
          cleanCupsAfterTrip: 0,
          usedCupsAfterTrip: 1,
          physicalCupsAfterTrip: 1,
          peakCupSlots: 1,
          peakOccupiedSlots: 10,
          juiceJarSlotsCarried: 9,
        },
      ],
      tripCount: 1,
      totalAssignedServings: 2,
      totalLeftoverServings: 0,
      leftoverJarContents: [],
      productionJarFills: [],
      allowDiscardRetainedJuice: false,
      discardedInitialJuice: [],
      discardedNewProductionJuice: [],
      maxJuiceJarSlotsCarried: 9,
      cleanCupUnitsRequiredWithoutMiddayWashing: 2,
      reusableCleanCupPoolSize: null,
      initialCleanCups: 2,
      initialUsedCups: 0,
      initialPhysicalCupCount: 2,
      finalCleanCups: 0,
      finalUsedCups: 1,
      finalPhysicalCupCount: 1,
      droppedUsedCups: 1,
      initialWashWaterUnits: 0,
      betweenTripWashWaterUnits: 0,
      totalCupWashWaterUnits: 0,
      returnsHomeBetweenTrips: false,
    }
    const plan = buildDeliveryExecutionPlan(
      dropShortfall,
      dropPlan,
    )
    let current: InventoryState = {
      ingredientUnits: {},
      waterUnits: 0,
      cleanCups: 2,
      usedCups: 0,
      juiceJars: carried.map((jar) => ({
        id: jar.physicalJarId,
        recipeId: jar.initialRecipeId,
        servings: jar.initialServings,
      })),
      shelfCount: 0,
      jarRackCount: 0,
    }
    let cursor = createDeliveryExecutionCursor(plan)

    const first = applyDeliveryExecutionCustomer(
      plan,
      current,
      cursor,
      'customer-1',
    )
    current = first.inventory
    cursor = first.cursor

    expect(first.changes.cup.droppedUsedCups).toBe(1)
    expect(current).toMatchObject({
      cleanCups: 1,
      usedCups: 0,
    })

    const second = applyDeliveryExecutionCustomer(
      plan,
      current,
      cursor,
      'customer-2',
    )

    expect(second.changes.cup.droppedUsedCups).toBe(0)
    expect(second.inventory).toMatchObject({
      cleanCups: 0,
      usedCups: 1,
    })
  })
  it('uses planned intermediate stock once when preparing a trip and matches whole-plan stock consumption', () => {
    const identity = 'juice-state:v1:lemon/sugar'
    const stockShortfall: PreparationShortfall = {
      recipes: [
        {
          recipeId: 'recipe-stock',
          recipeName: 'Stock',
          ingredientIds: ['lemon', 'sugar', 'mint'],
          assignedServings: 2,
          finishedServingsAvailable: 0,
          finishedServingsUsed: 0,
          finishedServingsRemaining: 0,
          finishedStockSources: [],
          servingsToProduce: 2,
          juiceUnitsToPrepare: 1,
          newlyProducedServings: 2,
          newProductionLeftoverServings: 0,
          ingredientUnitsPerJuiceUnit: [
            { ingredientId: 'lemon', quantityPerJuiceUnit: 1 },
            { ingredientId: 'sugar', quantityPerJuiceUnit: 1 },
            { ingredientId: 'mint', quantityPerJuiceUnit: 1 },
          ],
        },
      ],
      netProductionPlan: {
        steps: [],
        machineOperations: {
          total: 0,
          juicing: 0,
          seasoning: 0,
          finalizing: 0,
          blending: 0,
        },
      },
      intermediateStockUsage: [
        {
          identity,
          ingredientIds: ['lemon', 'sugar'],
          availableUnits: 2,
          usedUnits: 1,
          remainingUnits: 1,
        },
      ],
      stockOffsetRecipeUsage: [
        {
          recipeId: 'recipe-stock',
          ingredientUnits: { mint: 1 },
          intermediateStockUnits: { [identity]: 1 },
          units: [
            {
              ingredientUnits: { mint: 1 },
              intermediateStockUnits: { [identity]: 1 },
            },
          ],
        },
      ],
      ingredients: [
        {
          ingredientId: 'mint',
          name: '薄荷',
          requiredUnits: 1,
          inventoryUnitsAvailable: 1,
          inventoryUnitsUsed: 1,
          purchaseUnits: 0,
        },
      ],
      productionWaterUnitsRequired: 1,
      waterUnitsAvailable: 1,
      waterUnitsUsed: 1,
      waterUnitsToFetch: 0,
      cleanCupUses: 2,
      cleanCupsAvailable: 2,
      cleanCupShortfallBeforeWashing: 0,
      usedCupsAvailable: 0,
    }
    const stockPlan: MultiTripReplenishmentPlan = {
      policy: 'retain-and-wash',
      jarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 1,
      minimumCarriedJuiceJarSlots: 1,
      carriedJuiceJarCount: 1,
      carriedJuiceJars: [
        {
          physicalJarId: 'jar-stock',
          initialRecipeId: null,
          initialServings: 0,
        },
      ],
      physicalJarsUsed: 1,
      totalJarLoads: 1,
      distinctFinalJuiceTypes: 1,
      jarTypeSwitches: 0,
      trips: [
        {
          tripNumber: 1,
          juiceJars: [
            {
              physicalJarId: 'jar-stock',
              recipeId: 'recipe-stock',
              recipeName: 'Stock',
              customerIds: ['customer-1', 'customer-2'],
              servings: 2,
              retainedLeftoverServings: 0,
              plannedFillServings: 2,
              slotCost: 1,
              fillAction: 'initial-fill',
              previousRecipeId: null,
              previousRecipeName: null,
            },
          ],
          carriedPhysicalJarIds: ['jar-stock'],
          totalServings: 2,
          cleanCupStacks: 1,
          cleanCupsCarried: 2,
          departureSlots: 2,
          effectiveDepartureSlotLimit: 10,
          spareDepartureSlots: 8,
          reservedTransientUsedCupSlot: 1,
          usedCupDropMayOccur: false,
          droppedUsedCups: 0,
          cupsWashedBeforeTrip: 0,
          cupWashWaterUnits: 0,
          cleanCupsBeforeTrip: 2,
          usedCupsBeforeTrip: 0,
          cleanCupsAfterTrip: 0,
          usedCupsAfterTrip: 2,
          physicalCupsAfterTrip: 2,
          peakCupSlots: 2,
          peakOccupiedSlots: 3,
          juiceJarSlotsCarried: 1,
        },
      ],
      tripCount: 1,
      totalAssignedServings: 2,
      totalLeftoverServings: 0,
      leftoverJarContents: [],
      productionJarFills: [
        {
          physicalJarId: 'jar-stock',
          recipeId: 'recipe-stock',
          recipeName: 'Stock',
          beforeTripNumber: 1,
          servings: 2,
          servingsAfterFill: 2,
          fillAction: 'initial-fill',
          previousRecipeId: null,
          previousRecipeName: null,
          receiver: 'carried-jar',
        },
      ],
      allowDiscardRetainedJuice: false,
      discardedInitialJuice: [],
      discardedNewProductionJuice: [],
      maxJuiceJarSlotsCarried: 1,
      cleanCupUnitsRequiredWithoutMiddayWashing: 2,
      reusableCleanCupPoolSize: 2,
      initialCleanCups: 2,
      initialUsedCups: 0,
      initialPhysicalCupCount: 2,
      finalCleanCups: 0,
      finalUsedCups: 2,
      finalPhysicalCupCount: 2,
      droppedUsedCups: 0,
      initialWashWaterUnits: 0,
      betweenTripWashWaterUnits: 0,
      totalCupWashWaterUnits: 0,
      returnsHomeBetweenTrips: false,
    }
    const start: InventoryState = {
      ingredientUnits: { lemon: 9, sugar: 9, mint: 1 },
      intermediateJuiceUnits: { [identity]: 2 },
      waterUnits: 1,
      cleanCups: 2,
      usedCups: 0,
      juiceJars: [
        { id: 'jar-stock', recipeId: null, servings: 0 },
      ],
      shelfCount: 0,
      jarRackCount: 0,
    }

    const plan = buildDeliveryExecutionPlan(stockShortfall, stockPlan)
    let cursor = createDeliveryExecutionCursor(plan)
    const first = applyDeliveryExecutionCustomer(
      plan,
      start,
      cursor,
      'customer-1',
    )
    cursor = first.cursor

    expect(first.changes.intermediateJuice).toEqual([
      {
        identity,
        requiredUnits: 1,
        beforeUnits: 2,
        afterUnits: 1,
      },
    ])
    expect(first.changes.ingredients).toEqual([
      {
        ingredientId: 'mint',
        requiredUnits: 1,
        consumedFromInventory: 1,
        externalUnitsRequired: 0,
      },
    ])
    expect(first.inventory.intermediateJuiceUnits).toEqual({
      [identity]: 1,
    })
    expect(first.inventory.ingredientUnits).toEqual({
      lemon: 9,
      sugar: 9,
    })

    const second = applyDeliveryExecutionCustomer(
      plan,
      first.inventory,
      cursor,
      'customer-2',
    )
    expect(second.changes.intermediateJuice).toEqual([])
    expect(second.changes.ingredients).toEqual([])
    expect(second.inventory.intermediateJuiceUnits).toEqual({
      [identity]: 1,
    })
  })

  it('builds a canonical delivery from a later planned trip when the jar is already prepared', () => {
    const plan: DeliveryExecutionPlan = {
      planFingerprint: 'canonical-later-trip',
      policy: 'retain-and-wash',
      trips: [
        {
          tripNumber: 1,
          productionFills: [],
          initialJuiceDiscards: [],
          ingredientRequirements: [],
          intermediateRequirements: [],
          productionWaterUnits: 0,
          cupsWashedBeforeTrip: 0,
          cupWashWaterUnits: 0,
          cleanCupsBeforeTrip: 2,
          usedCupsBeforeTrip: 0,
          cleanCupsAfterTrip: 1,
          usedCupsAfterTrip: 1,
          juiceJarSlotsCarried: 1,
          deliveries: [{
            customerId: 'customer-first',
            physicalJarId: 'jar-first',
            recipeId: 'recipe-first',
            recipeName: 'First',
          }],
          newProductionDiscards: [],
        },
        {
          tripNumber: 2,
          productionFills: [],
          initialJuiceDiscards: [],
          ingredientRequirements: [],
          intermediateRequirements: [],
          productionWaterUnits: 0,
          cupsWashedBeforeTrip: 0,
          cupWashWaterUnits: 0,
          cleanCupsBeforeTrip: 1,
          usedCupsBeforeTrip: 1,
          cleanCupsAfterTrip: 0,
          usedCupsAfterTrip: 2,
          juiceJarSlotsCarried: 1,
          deliveries: [{
            customerId: 'customer-later',
            physicalJarId: 'jar-later',
            recipeId: 'recipe-later',
            recipeName: 'Later',
          }],
          newProductionDiscards: [],
        },
      ],
      finalCleanCups: 0,
      finalUsedCups: 2,
      finalPhysicalCupCount: 2,
    }
    const inventory: InventoryState = {
      ingredientUnits: {},
      intermediateJuiceUnits: {},
      waterUnits: 0,
      cleanCups: 2,
      usedCups: 0,
      juiceJars: [
        { id: 'jar-first', recipeId: 'recipe-first', servings: 1 },
        { id: 'jar-later', recipeId: 'recipe-later', servings: 1 },
      ],
      shelfCount: 0,
      jarRackCount: 0,
    }

    const draft = buildCanonicalDeliveryTransaction(
      plan,
      inventory,
      [],
      'customer-later',
    )

    expect(draft.status).toBe('ready')
    if (draft.status !== 'ready') return
    expect(draft.result.plannedTripNumber).toBe(2)
    expect(draft.result.inventory.cleanCups).toBe(1)
    expect(draft.result.inventory.usedCups).toBe(1)
    expect(draft.result.inventory.juiceJars).toEqual([
      { id: 'jar-first', recipeId: 'recipe-first', servings: 1 },
      { id: 'jar-later', recipeId: null, servings: 0 },
    ])
    expect(inventory).toMatchObject({
      cleanCups: 2,
      usedCups: 0,
    })
  })

  it('does not replay planned-trip preparation when a later-trip jar is not prepared', () => {
    const plan: DeliveryExecutionPlan = {
      planFingerprint: 'canonical-needs-preparation',
      policy: 'retain-and-wash',
      trips: [{
        tripNumber: 1,
        productionFills: [{
          physicalJarId: 'jar-a',
          recipeId: 'recipe-a',
          recipeName: 'A',
          beforeTripNumber: 1,
          servings: 2,
          servingsAfterFill: 2,
          fillAction: 'initial-fill',
          previousRecipeId: null,
          previousRecipeName: null,
          receiver: 'carried-jar',
        }],
        initialJuiceDiscards: [],
        ingredientRequirements: [{ ingredientId: 'lemon', units: 1 }],
        intermediateRequirements: [],
        productionWaterUnits: 1,
        cupsWashedBeforeTrip: 0,
        cupWashWaterUnits: 0,
        cleanCupsBeforeTrip: 1,
        usedCupsBeforeTrip: 0,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 1,
        juiceJarSlotsCarried: 1,
        deliveries: [{
          customerId: 'customer-a',
          physicalJarId: 'jar-a',
          recipeId: 'recipe-a',
          recipeName: 'A',
        }],
        newProductionDiscards: [],
      }],
      finalCleanCups: 0,
      finalUsedCups: 1,
      finalPhysicalCupCount: 1,
    }
    const inventory: InventoryState = {
      ingredientUnits: { lemon: 1 },
      intermediateJuiceUnits: {},
      waterUnits: 1,
      cleanCups: 1,
      usedCups: 0,
      juiceJars: [{ id: 'jar-a', recipeId: null, servings: 0 }],
      shelfCount: 0,
      jarRackCount: 0,
    }

    const draft = buildCanonicalDeliveryTransaction(
      plan,
      inventory,
      [],
      'customer-a',
    )

    expect(draft).toEqual({
      status: 'needs-preparation',
      customerId: 'customer-a',
      plannedTripNumber: 1,
      physicalJarId: 'jar-a',
      recipeId: 'recipe-a',
      preparation: null,
      events: null,
    })
    expect(inventory).toEqual({
      ingredientUnits: { lemon: 1 },
      intermediateJuiceUnits: {},
      waterUnits: 1,
      cleanCups: 1,
      usedCups: 0,
      juiceJars: [{ id: 'jar-a', recipeId: null, servings: 0 }],
      shelfCount: 0,
      jarRackCount: 0,
    })
  })

  it('rejects a canonical delivery for an already supplied customer', () => {
    const plan: DeliveryExecutionPlan = {
      planFingerprint: 'canonical-supplied',
      policy: 'retain-and-wash',
      trips: [{
        tripNumber: 1,
        productionFills: [],
        initialJuiceDiscards: [],
        ingredientRequirements: [],
        intermediateRequirements: [],
        productionWaterUnits: 0,
        cupsWashedBeforeTrip: 0,
        cupWashWaterUnits: 0,
        cleanCupsBeforeTrip: 1,
        usedCupsBeforeTrip: 0,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 1,
        juiceJarSlotsCarried: 1,
        deliveries: [{
          customerId: 'customer-a',
          physicalJarId: 'jar-a',
          recipeId: 'recipe-a',
          recipeName: 'A',
        }],
        newProductionDiscards: [],
      }],
      finalCleanCups: 0,
      finalUsedCups: 1,
      finalPhysicalCupCount: 1,
    }
    const inventory: InventoryState = {
      ingredientUnits: {},
      intermediateJuiceUnits: {},
      waterUnits: 0,
      cleanCups: 1,
      usedCups: 0,
      juiceJars: [{ id: 'jar-a', recipeId: 'recipe-a', servings: 1 }],
      shelfCount: 0,
      jarRackCount: 0,
    }

    expect(() =>
      buildCanonicalDeliveryTransaction(
        plan,
        inventory,
        ['customer-a'],
        'customer-a',
      ),
    ).toThrow('Customer customer-a is already supplied')
  })

})
