import { describe, expect, it } from 'vitest'
import type { InventoryState, PlannerSettings } from '../types'
import type { OptimizationResult } from './optimizer'
import { buildPreparationDemand } from './preparationDemand'
import {
  buildPreparationShortfall,
  type PreparationShortfall,
} from './preparationShortfall'
import {
  buildMultiTripReplenishmentPlan,
  type MultiTripReplenishmentPlan,
  type MultiTripSalesTrip,
} from './multiTripReplenishment'
import {
  buildProductionLogisticsPlan,
  type ProductionLogisticsPlan,
} from './productionLogistics'
import {
  PLAN_APPLICATION_TRANSACTION_SCHEMA,
  buildPlanApplicationTransactionDraft,
  type PlanApplicationBasisState,
} from './planApplicationTransaction'

function basis(): PlanApplicationBasisState {
  return {
    inventory: {
      ingredientUnits: {
        lemon: 3,
      },
      intermediateJuiceUnits: {
        'juice-state:v1:lemon': 2,
      },
      waterUnits: 4,
      cleanCups: 2,
      usedCups: 2,
      juiceJars: [
        {
          id: 'jar-a',
          recipeId: 'recipe-a',
          servings: 2,
        },
        {
          id: 'jar-b',
          recipeId: null,
          servings: 0,
        },
        {
          id: 'jar-c',
          recipeId: 'recipe-c',
          servings: 4,
        },
      ],
      shelfCount: 1,
      jarRackCount: 1,
    },
    currentProgress: 'juice-blender-unlocked',
    satisfactionByVillage: {
      'east-harbor': 120,
      'tranquil-fountain': 80,
    },
    formalCustomerIds: ['customer-1', 'customer-2'],
    suppliedCustomerIds: ['already-supplied'],
    plannerSettings: {
      juiceJarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 1,
      allowUsedCupDropIfFull: false,
      allowDiscardRetainedJuice: false,
    },
  }
}

function optimizationResult(): OptimizationResult {
  return {
    assignments: [
      {
        customerId: 'customer-1',
        recipeId: 'recipe-a',
      },
      {
        customerId: 'customer-2',
        recipeId: 'recipe-a',
      },
      {
        customerId: 'customer-3',
        recipeId: 'recipe-b',
      },
    ],
    recipePlans: [
      {
        recipeId: 'recipe-a',
        recipeName: 'A',
        customerIds: ['customer-1', 'customer-2'],
        juiceUnits: 1,
        producedServings: 2,
        assignedServings: 2,
        leftoverServings: 0,
        ingredientIds: ['lemon'],
        juiceUnitIngredientCost: 1,
        totalIngredientCost: 1,
      },
      {
        recipeId: 'recipe-b',
        recipeName: 'B',
        customerIds: ['customer-3'],
        juiceUnits: 1,
        producedServings: 2,
        assignedServings: 1,
        leftoverServings: 1,
        ingredientIds: ['lemon', 'sugar', 'sugar'],
        juiceUnitIngredientCost: 3,
        totalIngredientCost: 3,
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
    jarTypeSwitches: 1,
    availableJuiceJarCount: 1,
    shoppingList: [],
    unresolvedCustomers: [],
    totalIngredientCost: 4,
    knownSalesRevenue: 0,
    knownGrossProfit: -4,
    formalSalesCount: 2,
    potentialTrialCount: 1,
    unknownFormalSalePriceCount: 0,
    producedServings: 4,
    assignedServings: 3,
    leftoverServings: 1,
  }
}

function shortfall(
  waterUnitsAvailable = 4,
): PreparationShortfall {
  return {
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
            physicalJarId: 'jar-a',
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
          {
            ingredientId: 'lemon',
            quantityPerJuiceUnit: 1,
          },
        ],
      },
      {
        recipeId: 'recipe-b',
        recipeName: 'B',
        ingredientIds: ['lemon', 'sugar', 'sugar'],
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
          {
            ingredientId: 'lemon',
            quantityPerJuiceUnit: 1,
          },
          {
            ingredientId: 'sugar',
            quantityPerJuiceUnit: 2,
          },
        ],
      },
    ],
    ingredients: [
      {
        ingredientId: 'lemon',
        name: '檸檬',
        requiredUnits: 1,
        inventoryUnitsAvailable: 3,
        inventoryUnitsUsed: 1,
        purchaseUnits: 0,
      },
      {
        ingredientId: 'sugar',
        name: '糖',
        requiredUnits: 2,
        inventoryUnitsAvailable: 0,
        inventoryUnitsUsed: 0,
        purchaseUnits: 2,
      },
    ],
    productionWaterUnitsRequired: 1,
    waterUnitsAvailable,
    waterUnitsUsed: Math.min(1, waterUnitsAvailable),
    waterUnitsToFetch: Math.max(0, 1 - waterUnitsAvailable),
    cleanCupUses: 3,
    cleanCupsAvailable: 2,
    cleanCupShortfallBeforeWashing: 1,
    usedCupsAvailable: 2,
  }
}

function salesTrip(
  tripNumber: number,
  overrides: Partial<MultiTripSalesTrip>,
): MultiTripSalesTrip {
  return {
    tripNumber,
    juiceJars: [],
    carriedPhysicalJarIds: [],
    totalServings: 0,
    cleanCupStacks: 0,
    cleanCupsCarried: 0,
    departureSlots: 1,
    effectiveDepartureSlotLimit: 10,
    spareDepartureSlots: 9,
    reservedTransientUsedCupSlot: 0,
    usedCupDropMayOccur: false,
    droppedUsedCups: 0,
    cupsWashedBeforeTrip: 0,
    cupWashWaterUnits: 0,
    cleanCupsBeforeTrip: 0,
    usedCupsBeforeTrip: 0,
    cleanCupsAfterTrip: 0,
    usedCupsAfterTrip: 0,
    physicalCupsAfterTrip: 0,
    peakCupSlots: 0,
    peakOccupiedSlots: 1,
    juiceJarSlotsCarried: 1,
    ...overrides,
  }
}

function salesPlan(): MultiTripReplenishmentPlan {
  return {
    policy: 'retain-and-wash',
    jarCarryMode: 'fixed-slots',
    reservedJuiceJarSlots: 1,
    minimumCarriedJuiceJarSlots: 1,
    carriedJuiceJarCount: 1,
    carriedJuiceJars: [
      {
        physicalJarId: 'jar-a',
        initialRecipeId: 'recipe-a',
        initialServings: 2,
      },
    ],
    physicalJarsUsed: 1,
    totalJarLoads: 2,
    distinctFinalJuiceTypes: 2,
    jarTypeSwitches: 1,
    trips: [
      salesTrip(1, {
        juiceJars: [
          {
            physicalJarId: 'jar-a',
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
        carriedPhysicalJarIds: ['jar-a'],
        totalServings: 2,
        cleanCupStacks: 1,
        cleanCupsCarried: 2,
        departureSlots: 2,
        spareDepartureSlots: 8,
        cleanCupsBeforeTrip: 2,
        usedCupsBeforeTrip: 2,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 4,
        physicalCupsAfterTrip: 4,
        peakCupSlots: 2,
        peakOccupiedSlots: 3,
      }),
      salesTrip(2, {
        juiceJars: [
          {
            physicalJarId: 'jar-a',
            recipeId: 'recipe-b',
            recipeName: 'B',
            customerIds: ['customer-3'],
            servings: 1,
            retainedLeftoverServings: 1,
            plannedFillServings: 2,
            slotCost: 1,
            fillAction: 'type-switch',
            previousRecipeId: 'recipe-a',
            previousRecipeName: 'A',
          },
        ],
        carriedPhysicalJarIds: ['jar-a'],
        totalServings: 1,
        cleanCupStacks: 1,
        cleanCupsCarried: 1,
        departureSlots: 2,
        spareDepartureSlots: 8,
        cupsWashedBeforeTrip: 1,
        cupWashWaterUnits: 1,
        cleanCupsBeforeTrip: 0,
        usedCupsBeforeTrip: 4,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 4,
        physicalCupsAfterTrip: 4,
        peakCupSlots: 1,
        peakOccupiedSlots: 2,
      }),
    ],
    tripCount: 2,
    totalAssignedServings: 3,
    totalLeftoverServings: 1,
    leftoverJarContents: [
      {
        physicalJarId: 'jar-a',
        recipeId: 'recipe-b',
        recipeName: 'B',
        servings: 1,
        tripNumber: 2,
      },
    ],
    allowDiscardRetainedJuice: false,
    discardedInitialJuice: [],
    discardedNewProductionJuice: [],
    productionJarFills: [
      {
        physicalJarId: 'jar-a',
        recipeId: 'recipe-b',
        recipeName: 'B',
        beforeTripNumber: 2,
        servings: 2,
        servingsAfterFill: 2,
        fillAction: 'type-switch',
        previousRecipeId: 'recipe-a',
        previousRecipeName: 'A',
        receiver: 'carried-jar',
      },
    ],
    maxJuiceJarSlotsCarried: 1,
    cleanCupUnitsRequiredWithoutMiddayWashing: 3,
    reusableCleanCupPoolSize: 2,
    initialCleanCups: 2,
    initialUsedCups: 2,
    initialPhysicalCupCount: 4,
    finalCleanCups: 0,
    finalUsedCups: 4,
    finalPhysicalCupCount: 4,
    droppedUsedCups: 0,
    initialWashWaterUnits: 0,
    betweenTripWashWaterUnits: 1,
    totalCupWashWaterUnits: 1,
    returnsHomeBetweenTrips: true,
  }
}

function productionLogistics(
  feasible = true,
): ProductionLogisticsPlan {
  const snapshot = {
    shelfSlotsUsed: 0,
    shelfSlotsAvailable: 9,
    backpackSlotsUsed: 0,
    backpackSlotsAvailable: 9,
    carriedJarSlots: 1,
    outputJarReceiverSlots: 1,
    carriedOutputJarSlots: 1,
    rackOutputJarSlots: 0,
    machineSlotsUsed: 0,
    machineSlotsAvailable: 0,
  }

  return {
    feasible,
    issues: feasible ? [] : ['blocked'],
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

describe('plan application transaction', () => {
  it('builds an immutable before/after draft without mutating planning inputs', () => {
    const input = {
      basis: basis(),
      result: optimizationResult(),
      preparationShortfall: shortfall(),
      productionLogistics: productionLogistics(),
      salesPlan: salesPlan(),
    }
    const inputBefore = JSON.stringify(input)

    const draft = buildPlanApplicationTransactionDraft(input)

    expect(JSON.stringify(input)).toBe(inputBefore)
    expect(draft.schemaVersion).toBe(
      PLAN_APPLICATION_TRANSACTION_SCHEMA,
    )
    expect(draft.before.inventory).toEqual(input.basis.inventory)
    expect(draft.after.inventory.ingredientUnits).toEqual({
      lemon: 2,
    })
    expect(draft.after.inventory.intermediateJuiceUnits).toEqual({
      'juice-state:v1:lemon': 2,
    })
    expect(draft.after.inventory.waterUnits).toBe(2)
    expect(draft.after.inventory.cleanCups).toBe(0)
    expect(draft.after.inventory.usedCups).toBe(4)
    expect(draft.after.inventory.juiceJars).toEqual([
      {
        id: 'jar-a',
        recipeId: 'recipe-b',
        servings: 1,
      },
      {
        id: 'jar-b',
        recipeId: null,
        servings: 0,
      },
      {
        id: 'jar-c',
        recipeId: 'recipe-c',
        servings: 4,
      },
    ])
    expect(draft.after.suppliedCustomerIds).toEqual([
      'already-supplied',
      'customer-1',
      'customer-2',
      'customer-3',
    ])
    expect(draft.after.currentProgress).toBe(
      draft.before.currentProgress,
    )
    expect(draft.after.formalCustomerIds).toEqual(
      draft.before.formalCustomerIds,
    )
    expect(draft.after.plannerSettings).toEqual(
      draft.before.plannerSettings,
    )

    expect(draft.changes.ingredients).toEqual([
      {
        ingredientId: 'lemon',
        beforeUnits: 3,
        afterUnits: 2,
        consumedFromInventory: 1,
        acquiredAndConsumedUnits: 0,
      },
      {
        ingredientId: 'sugar',
        beforeUnits: 0,
        afterUnits: 0,
        consumedFromInventory: 0,
        acquiredAndConsumedUnits: 2,
      },
    ])
    expect(draft.changes.water).toEqual({
      beforeUnits: 4,
      afterUnits: 2,
      consumedFromInventory: 2,
      productionUnitsRequired: 1,
      cupWashUnitsRequired: 1,
      externalUnitsRequired: 0,
    })
    expect(draft.changes.cups).toEqual({
      cleanBefore: 2,
      cleanAfter: 0,
      usedBefore: 2,
      usedAfter: 4,
      physicalBefore: 4,
      physicalAfter: 4,
      droppedUsedCups: 0,
    })
    expect(draft.changes.juiceJars).toEqual([
      {
        physicalJarId: 'jar-a',
        before: {
          id: 'jar-a',
          recipeId: 'recipe-a',
          servings: 2,
        },
        after: {
          id: 'jar-a',
          recipeId: 'recipe-b',
          servings: 1,
        },
      },
    ])
    expect(draft.changes.newlySuppliedCustomerIds).toEqual([
      'customer-1',
      'customer-2',
      'customer-3',
    ])

    expect(Object.isFrozen(draft)).toBe(true)
    expect(Object.isFrozen(draft.before)).toBe(true)
    expect(Object.isFrozen(draft.after.inventory)).toBe(true)
    expect(Object.isFrozen(draft.after.inventory.juiceJars)).toBe(
      true,
    )
    expect(Object.isFrozen(draft.changes)).toBe(true)
  })


  it('preserves a same-recipe terminal leftover in the transaction after snapshot', () => {
    const transactionBasis = basis()
    transactionBasis.inventory.juiceJars = [
      {
        id: 'jar-a',
        recipeId: 'recipe-a',
        servings: 1,
      },
    ]

    const result = optimizationResult()
    result.assignments = [
      { customerId: 'customer-1', recipeId: 'recipe-a' },
      { customerId: 'customer-2', recipeId: 'recipe-a' },
    ]
    result.recipePlans = [result.recipePlans[0]]
    result.assignedServings = 2
    result.producedServings = 2
    result.leftoverServings = 0
    result.totalIngredientCost = 1
    result.knownGrossProfit = -1

    const preparation = shortfall()
    preparation.recipes = [
      {
        ...preparation.recipes[0],
        assignedServings: 2,
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
        servingsToProduce: 1,
        juiceUnitsToPrepare: 1,
        newlyProducedServings: 2,
        newProductionLeftoverServings: 1,
      },
    ]
    preparation.ingredients = [
      {
        ingredientId: 'lemon',
        name: '檸檬',
        requiredUnits: 1,
        inventoryUnitsAvailable: 3,
        inventoryUnitsUsed: 1,
        purchaseUnits: 0,
      },
    ]
    preparation.productionWaterUnitsRequired = 1
    preparation.waterUnitsUsed = 1
    preparation.waterUnitsToFetch = 0
    preparation.cleanCupUses = 2
    preparation.cleanCupShortfallBeforeWashing = 0

    const plan = salesPlan()
    plan.carriedJuiceJars = [
      {
        physicalJarId: 'jar-a',
        initialRecipeId: 'recipe-a',
        initialServings: 1,
      },
    ]
    plan.trips = [
      salesTrip(1, {
        juiceJars: [
          {
            physicalJarId: 'jar-a',
            recipeId: 'recipe-a',
            recipeName: 'A',
            customerIds: ['customer-1'],
            servings: 1,
            retainedLeftoverServings: 0,
            plannedFillServings: 0,
            slotCost: 1,
            fillAction: 'use-existing',
            previousRecipeId: 'recipe-a',
            previousRecipeName: 'A',
          },
        ],
        carriedPhysicalJarIds: ['jar-a'],
        totalServings: 1,
      }),
      salesTrip(2, {
        juiceJars: [
          {
            physicalJarId: 'jar-a',
            recipeId: 'recipe-a',
            recipeName: 'A',
            customerIds: ['customer-2'],
            servings: 1,
            retainedLeftoverServings: 1,
            plannedFillServings: 2,
            slotCost: 1,
            fillAction: 'refill-same-type',
            previousRecipeId: 'recipe-a',
            previousRecipeName: 'A',
          },
        ],
        carriedPhysicalJarIds: ['jar-a'],
        totalServings: 1,
      }),
    ]
    plan.tripCount = 2
    plan.totalAssignedServings = 2
    plan.totalLeftoverServings = 1
    plan.leftoverJarContents = [
      {
        physicalJarId: 'jar-a',
        recipeId: 'recipe-a',
        recipeName: 'A',
        servings: 1,
        tripNumber: 2,
      },
    ]
    plan.productionJarFills = [
      {
        physicalJarId: 'jar-a',
        recipeId: 'recipe-a',
        recipeName: 'A',
        beforeTripNumber: 2,
        servings: 2,
        servingsAfterFill: 2,
        fillAction: 'refill-same-type',
        previousRecipeId: 'recipe-a',
        previousRecipeName: 'A',
        receiver: 'carried-jar',
      },
    ]
    plan.jarTypeSwitches = 0
    plan.distinctFinalJuiceTypes = 1

    const draft = buildPlanApplicationTransactionDraft({
      basis: transactionBasis,
      result,
      preparationShortfall: preparation,
      productionLogistics: productionLogistics(),
      salesPlan: plan,
    })

    expect(draft.after.inventory.juiceJars).toEqual([
      {
        id: 'jar-a',
        recipeId: 'recipe-a',
        servings: 1,
      },
    ])
    expect(draft.changes.juiceJars).toEqual([])
  })

  it('keeps the true three-trip terminal leftover through shortfall, sales plan, and transaction state', () => {
    const result: OptimizationResult = {
      assignments: [
        { customerId: 'a-customer-1', recipeId: 'a' },
        { customerId: 'a-customer-2', recipeId: 'a' },
        { customerId: 'b-customer-1', recipeId: 'b' },
      ],
      recipePlans: [
        {
          recipeId: 'a',
          recipeName: 'A',
          customerIds: ['a-customer-1', 'a-customer-2'],
          juiceUnits: 1,
          producedServings: 2,
          assignedServings: 2,
          leftoverServings: 0,
          ingredientIds: ['lemon'],
          juiceUnitIngredientCost: 1,
          totalIngredientCost: 1,
        },
        {
          recipeId: 'b',
          recipeName: 'B',
          customerIds: ['b-customer-1'],
          juiceUnits: 1,
          producedServings: 2,
          assignedServings: 1,
          leftoverServings: 1,
          ingredientIds: ['orange'],
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
      knownGrossProfit: -2,
      formalSalesCount: 3,
      potentialTrialCount: 0,
      unknownFormalSalePriceCount: 0,
      producedServings: 4,
      assignedServings: 3,
      leftoverServings: 1,
    }
    const inventory: InventoryState = {
      ingredientUnits: {
        lemon: 2,
        orange: 2,
      },
      intermediateJuiceUnits: {},
      waterUnits: 10,
      cleanCups: 1,
      usedCups: 0,
      juiceJars: [
        {
          id: 'jar-1',
          recipeId: 'a',
          servings: 1,
        },
        {
          id: 'jar-2',
          recipeId: 'b',
          servings: 1,
        },
      ],
      shelfCount: 1,
      jarRackCount: 1,
    }
    const plannerSettings: PlannerSettings = {
      juiceJarCarryMode: 'auto',
      reservedJuiceJarSlots: 0,
      allowUsedCupDropIfFull: false,
      allowDiscardRetainedJuice: false,
    }

    const preparationDemand = buildPreparationDemand(result)
    const preparationShortfall = buildPreparationShortfall(
      preparationDemand,
      inventory,
    )
    const salesPlan = buildMultiTripReplenishmentPlan(
      preparationDemand,
      'retain-and-wash',
      inventory.juiceJars,
      {
        cleanCups: inventory.cleanCups,
        usedCups: inventory.usedCups,
      },
      preparationShortfall,
      {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
      false,
    )

    expect(salesPlan.tripCount).toBe(3)
    expect(salesPlan.trips[1]?.juiceJars).toEqual([
      expect.objectContaining({
        physicalJarId: 'jar-1',
        recipeId: 'a',
        retainedLeftoverServings: 1,
      }),
    ])
    expect(salesPlan.trips[2]?.juiceJars).toEqual([
      expect.objectContaining({
        physicalJarId: 'jar-2',
        recipeId: 'b',
        retainedLeftoverServings: 0,
      }),
    ])
    expect(salesPlan.leftoverJarContents).toEqual([
      {
        physicalJarId: 'jar-1',
        recipeId: 'a',
        recipeName: 'A',
        servings: 1,
        tripNumber: 2,
      },
    ])
    expect(salesPlan.totalLeftoverServings).toBe(1)

    const logistics = buildProductionLogisticsPlan(
      preparationShortfall,
      inventory,
      plannerSettings,
      salesPlan.productionJarFills,
    )
    expect(logistics.feasible).toBe(true)

    const draft = buildPlanApplicationTransactionDraft({
      basis: {
        inventory,
        currentProgress: 'opening',
        satisfactionByVillage: {
          'east-harbor': 0,
          'tranquil-fountain': 0,
        },
        formalCustomerIds: [
          'a-customer-1',
          'a-customer-2',
          'b-customer-1',
        ],
        suppliedCustomerIds: [],
        plannerSettings,
      },
      result,
      preparationShortfall,
      productionLogistics: logistics,
      salesPlan,
    })

    expect(draft.after.inventory.juiceJars).toEqual([
      {
        id: 'jar-1',
        recipeId: 'a',
        servings: 1,
      },
      {
        id: 'jar-2',
        recipeId: null,
        servings: 0,
      },
    ])
  })

  it('consumes only planned intermediate stock and preserves the unused remainder', () => {
    const preparation = shortfall()
    preparation.intermediateStockUsage = [
      {
        identity: 'juice-state:v1:lemon',
        ingredientIds: ['lemon'],
        availableUnits: 2,
        usedUnits: 1,
        remainingUnits: 1,
      },
    ]

    const draft = buildPlanApplicationTransactionDraft({
      basis: basis(),
      result: optimizationResult(),
      preparationShortfall: preparation,
      productionLogistics: productionLogistics(),
      salesPlan: salesPlan(),
    })

    expect(draft.after.inventory.intermediateJuiceUnits).toEqual({
      'juice-state:v1:lemon': 1,
    })
    expect(draft.changes.intermediateJuice).toEqual([
      {
        identity: 'juice-state:v1:lemon',
        ingredientIds: ['lemon'],
        beforeUnits: 2,
        afterUnits: 1,
        consumedUnits: 1,
      },
    ])
  })

  it('uses existing water first and exposes any additional same-day water requirement', () => {
    const transactionBasis = basis()
    transactionBasis.inventory.waterUnits = 0

    const draft = buildPlanApplicationTransactionDraft({
      basis: transactionBasis,
      result: optimizationResult(),
      preparationShortfall: shortfall(0),
      productionLogistics: productionLogistics(),
      salesPlan: salesPlan(),
    })

    expect(draft.after.inventory.waterUnits).toBe(0)
    expect(draft.changes.water).toEqual({
      beforeUnits: 0,
      afterUnits: 0,
      consumedFromInventory: 0,
      productionUnitsRequired: 1,
      cupWashUnitsRequired: 1,
      externalUnitsRequired: 2,
    })
  })

  it('rejects applying a result that already includes a supplied customer', () => {
    const transactionBasis = basis()
    transactionBasis.suppliedCustomerIds.push('customer-1')

    expect(() =>
      buildPlanApplicationTransactionDraft({
        basis: transactionBasis,
        result: optimizationResult(),
        preparationShortfall: shortfall(),
        productionLogistics: productionLogistics(),
        salesPlan: salesPlan(),
      }),
    ).toThrow(
      'Optimization result includes already supplied customer customer-1',
    )
  })

  it('rejects a carried jar whose planned initial contents no longer match inventory', () => {
    const transactionBasis = basis()
    transactionBasis.inventory.juiceJars[0] = {
      id: 'jar-a',
      recipeId: 'recipe-a',
      servings: 1,
    }

    expect(() =>
      buildPlanApplicationTransactionDraft({
        basis: transactionBasis,
        result: optimizationResult(),
        preparationShortfall: shortfall(),
        productionLogistics: productionLogistics(),
        salesPlan: salesPlan(),
      }),
    ).toThrow(
      'Sales plan initial contents do not match physical jar jar-a',
    )
  })

  it('rejects retained-juice discard events when explicit opt-in is off', () => {
    const plan = salesPlan()
    plan.discardedInitialJuice = [
      {
        physicalJarId: 'jar-a',
        recipeId: 'recipe-a',
        servings: 1,
      },
    ]

    expect(() =>
      buildPlanApplicationTransactionDraft({
        basis: basis(),
        result: optimizationResult(),
        preparationShortfall: shortfall(),
        productionLogistics: productionLogistics(),
        salesPlan: plan,
      }),
    ).toThrow(
      'Sales plan cannot discard juice without explicit opt-in',
    )
  })

  it('records a new-production leftover discard separately from initial contents', () => {
    const transactionBasis = basis()
    transactionBasis.plannerSettings.allowDiscardRetainedJuice = true
    const plan = salesPlan()
    plan.allowDiscardRetainedJuice = true
    plan.trips[1].juiceJars[0].retainedLeftoverServings = 0
    plan.leftoverJarContents = []
    plan.totalLeftoverServings = 0
    plan.discardedNewProductionJuice = [
      {
        physicalJarId: 'jar-a',
        recipeId: 'recipe-b',
        recipeName: 'B',
        servings: 1,
        afterTripNumber: 2,
      },
    ]

    const draft = buildPlanApplicationTransactionDraft({
      basis: transactionBasis,
      result: optimizationResult(),
      preparationShortfall: shortfall(),
      productionLogistics: productionLogistics(),
      salesPlan: plan,
    })

    expect(draft.after.inventory.juiceJars).toContainEqual({
      id: 'jar-a',
      recipeId: null,
      servings: 0,
    })
    expect(draft.changes.discardedJuice).toEqual([
      {
        source: 'new-production-leftover',
        physicalJarId: 'jar-a',
        recipeId: 'recipe-b',
        servings: 1,
        afterTripNumber: 2,
      },
    ])
  })

  it('rejects new-production discard events when explicit opt-in is off', () => {
    const plan = salesPlan()
    plan.discardedNewProductionJuice = [
      {
        physicalJarId: 'jar-a',
        recipeId: 'recipe-b',
        recipeName: 'B',
        servings: 1,
        afterTripNumber: 2,
      },
    ]

    expect(() =>
      buildPlanApplicationTransactionDraft({
        basis: basis(),
        result: optimizationResult(),
        preparationShortfall: shortfall(),
        productionLogistics: productionLogistics(),
        salesPlan: plan,
      }),
    ).toThrow(
      'Sales plan cannot discard juice without explicit opt-in',
    )
  })

  it('rejects an infeasible production logistics plan', () => {
    expect(() =>
      buildPlanApplicationTransactionDraft({
        basis: basis(),
        result: optimizationResult(),
        preparationShortfall: shortfall(),
        productionLogistics: productionLogistics(false),
        salesPlan: salesPlan(),
      }),
    ).toThrow(
      'Cannot build an application transaction from an infeasible production logistics plan',
    )
  })

  it('rejects sales customers that drift from optimizer assignments', () => {
    const plan = salesPlan()
    plan.trips[1].juiceJars[0].customerIds = [
      'different-customer',
    ]

    expect(() =>
      buildPlanApplicationTransactionDraft({
        basis: basis(),
        result: optimizationResult(),
        preparationShortfall: shortfall(),
        productionLogistics: productionLogistics(),
        salesPlan: plan,
      }),
    ).toThrow(
      'Sales plan customers do not match optimization assignments',
    )
  })
})
