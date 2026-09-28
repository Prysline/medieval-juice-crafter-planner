import { describe, expect, it } from 'vitest'
import type { OptimizationResult } from './optimizer'
import type { PreparationDemand } from './preparationDemand'
import { buildPreparationShortfall } from './preparationShortfall'
import { buildMultiTripReplenishmentPlan } from './multiTripReplenishment'
import { buildCustomSalesTripBaseline } from './customSalesTripPlan'
import { buildAppliedCustomSalesTrip } from './appliedCustomSalesTrip'

function fixture() {
  const demand: PreparationDemand = {
    ingredients: [
      { ingredientId: 'lemon', name: '檸檬', quantity: 1 },
      { ingredientId: 'orange', name: '橙子', quantity: 1 },
    ],
    productionWaterUnits: 2,
    cleanCupUses: 4,
    producedServings: 4,
    assignedServings: 4,
    leftoverServings: 0,
    recipes: [
      {
        recipeId: 'recipe-a',
        recipeName: 'A',
        customerIds: ['a1', 'a2'],
        ingredientIds: ['lemon'],
        productionUnits: 1,
        producedServings: 2,
        assignedServings: 2,
        leftoverServings: 0,
        ingredientUnitsPerJuiceUnit: [
          { ingredientId: 'lemon', quantityPerJuiceUnit: 1 },
        ],
      },
      {
        recipeId: 'recipe-b',
        recipeName: 'B',
        customerIds: ['b1', 'b2'],
        ingredientIds: ['orange'],
        productionUnits: 1,
        producedServings: 2,
        assignedServings: 2,
        leftoverServings: 0,
        ingredientUnitsPerJuiceUnit: [
          { ingredientId: 'orange', quantityPerJuiceUnit: 1 },
        ],
      },
    ],
  }
  const inventory = {
    ingredientUnits: { lemon: 1, orange: 1 },
    intermediateJuiceUnits: {},
    waterUnits: 2,
    cleanCups: 2,
    usedCups: 0,
    juiceJars: [
      { id: 'jar-1', recipeId: null, servings: 0 },
      { id: 'jar-2', recipeId: null, servings: 0 },
    ],
    shelfCount: 1,
    jarRackCount: 1,
  }
  const shortfall = buildPreparationShortfall(
    demand,
    inventory,
    { finishedJuiceJarIds: ['jar-1', 'jar-2'] },
  )
  const salesPlan = buildMultiTripReplenishmentPlan(
    demand,
    'retain-and-wash',
    inventory.juiceJars,
    { cleanCups: 2, usedCups: 0 },
    shortfall,
    {
      mode: 'auto',
      reservedSlots: 0,
      minimumCarriedSlots: 0,
    },
    false,
    {
      fixedCustomerTrips: [
        { customerIds: ['b1', 'b2'] },
        { customerIds: ['a1', 'a2'] },
      ],
    },
  )
  const customerRegionById = {
    a1: 'east-harbor',
    a2: 'east-harbor',
    b1: 'ibex-statue',
    b2: 'ibex-statue',
  }
  const planningPlan = buildCustomSalesTripBaseline({
    recipeAssignments: demand.recipes.map((recipe) => ({
      recipeId: recipe.recipeId,
      customerIds: recipe.customerIds,
    })),
    physicalTrips: salesPlan.trips.map((trip) => ({
      tripNumber: trip.tripNumber,
      juiceJars: trip.juiceJars.map((load) => ({
        recipeId: load.recipeId,
        customerIds: load.customerIds,
      })),
    })),
    customerRegionById,
  })
  const result: OptimizationResult = {
    assignments: [
      { customerId: 'a1', recipeId: 'recipe-a' },
      { customerId: 'a2', recipeId: 'recipe-a' },
      { customerId: 'b1', recipeId: 'recipe-b' },
      { customerId: 'b2', recipeId: 'recipe-b' },
    ],
    recipePlans: [
      {
        recipeId: 'recipe-a',
        recipeName: 'A',
        customerIds: ['a1', 'a2'],
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
        customerIds: ['b1', 'b2'],
        juiceUnits: 1,
        producedServings: 2,
        assignedServings: 2,
        leftoverServings: 0,
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
    formalSalesCount: 0,
    potentialTrialCount: 4,
    unknownFormalSalePriceCount: 0,
    producedServings: 4,
    assignedServings: 4,
    leftoverServings: 0,
  }

  return {
    demand,
    inventory,
    shortfall,
    salesPlan,
    planningPlan,
    result,
    customerRegionById,
  }
}

describe('applied custom sales trip downstream integration', () => {
  it('keeps the custom trip order in Region presentation, transaction, and delivery execution', () => {
    const f = fixture()
    const built = buildAppliedCustomSalesTrip({
      planningPlan: f.planningPlan,
      salesPlan: f.salesPlan,
      demand: f.demand,
      result: f.result,
      shortfall: f.shortfall,
      basis: {
        inventory: f.inventory,
        currentProgress: 'juice-blender-unlocked',
        satisfactionByVillage: {
          'east-harbor': 0,
          'tranquil-fountain': 0,
          'ibex-statue': 0,
        },
        formalCustomerIds: [],
        originalSuppliedCustomerIds: [],
        currentSuppliedCustomerIds: ['b1'],
        plannerSettings: {
          juiceJarCarryMode: 'auto',
          reservedJuiceJarSlots: 0,
          allowUsedCupDropIfFull: false,
          allowDiscardRetainedJuice: false,
        },
      },
      region: {
        activeWorkshop: {
          id: 'workshop:east-harbor',
          regionId: 'east-harbor',
        },
        topology: {
          edges: [
            {
              from: 'east-harbor',
              to: 'tranquil-fountain',
              cost: 1,
            },
            {
              from: 'tranquil-fountain',
              to: 'ibex-statue',
              cost: 1,
            },
          ],
        },
        customerRegionById: f.customerRegionById,
      },
    })

    expect(built.status).toBe('valid')
    if (built.status !== 'valid') return

    expect(
      built.downstream.appliedPlan.regionPlan.trips.map((trip) =>
        trip.physicalTrip.juiceJars.flatMap(
          (load) => load.customerIds,
        ),
      ),
    ).toEqual([
      ['b1', 'b2'],
      ['a1', 'a2'],
    ])
    expect(
      built.downstream.deliveryExecutionPlan.trips.map((trip) =>
        trip.deliveries.map((delivery) => delivery.customerId),
      ),
    ).toEqual([
      ['b1', 'b2'],
      ['a1', 'a2'],
    ])
    expect(
      built.downstream.transactionDraft.before.suppliedCustomerIds,
    ).toEqual(['b1'])
    expect(
      built.downstream.transactionDraft.changes
        .newlySuppliedCustomerIds,
    ).toEqual(['a1', 'a2', 'b2'])
    expect(
      built.downstream.transactionDraft.after.suppliedCustomerIds,
    ).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('rejects an incompatible supplied-state drift instead of creating an applied plan', () => {
    const f = fixture()
    const built = buildAppliedCustomSalesTrip({
      planningPlan: f.planningPlan,
      salesPlan: f.salesPlan,
      demand: f.demand,
      result: f.result,
      shortfall: f.shortfall,
      basis: {
        inventory: f.inventory,
        currentProgress: 'juice-blender-unlocked',
        satisfactionByVillage: {
          'east-harbor': 0,
          'tranquil-fountain': 0,
          'ibex-statue': 0,
        },
        formalCustomerIds: [],
        originalSuppliedCustomerIds: [],
        currentSuppliedCustomerIds: ['outside-plan'],
        plannerSettings: {
          juiceJarCarryMode: 'auto',
          reservedJuiceJarSlots: 0,
          allowUsedCupDropIfFull: false,
          allowDiscardRetainedJuice: false,
        },
      },
      region: {
        activeWorkshop: {
          id: 'workshop:east-harbor',
          regionId: 'east-harbor',
        },
        topology: {
          edges: [
            {
              from: 'east-harbor',
              to: 'tranquil-fountain',
              cost: 1,
            },
            {
              from: 'tranquil-fountain',
              to: 'ibex-statue',
              cost: 1,
            },
          ],
        },
        customerRegionById: f.customerRegionById,
      },
    })

    expect(built).toEqual({
      status: 'invalid',
      message:
        '目前的今日已供應紀錄無法與這份自訂規劃安全對齊；請先修正交付紀錄或重新產生規劃。',
    })
  })
})
