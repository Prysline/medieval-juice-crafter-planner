import { describe, expect, it } from 'vitest'
import type {
  InventoryState,
  JuiceJarInventoryItem,
} from '../types'
import type { PreparationDemand } from './preparationDemand'
import { buildPreparationShortfall } from './preparationShortfall'
import {
  buildRegionPhysicalSalesPlan,
  type RegionPhysicalSalesPlan,
} from './regionPhysicalSalesPlanner'

function demand(
  recipes: Array<{
    recipeId: string
    recipeName: string
    customerIds: string[]
  }>,
): PreparationDemand {
  const assignedServings = recipes.reduce(
    (sum, recipe) => sum + recipe.customerIds.length,
    0,
  )

  return {
    ingredients: [],
    productionWaterUnits: recipes.length,
    cleanCupUses: assignedServings,
    producedServings: assignedServings,
    assignedServings,
    leftoverServings: 0,
    recipes: recipes.map((recipe) => ({
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
      customerIds: [...recipe.customerIds],
      ingredientIds: [],
      productionUnits: recipe.customerIds.length / 2,
      producedServings: recipe.customerIds.length,
      assignedServings: recipe.customerIds.length,
      leftoverServings: 0,
      ingredientUnitsPerJuiceUnit: [],
    })),
  }
}

function inventory(
  jars: JuiceJarInventoryItem[],
  cleanCups: number,
): InventoryState {
  return {
    ingredientUnits: {},
    intermediateJuiceUnits: {},
    waterUnits: 0,
    cleanCups,
    usedCups: 0,
    juiceJars: jars,
    shelfCount: 0,
    jarRackCount: 1,
  }
}

function playerRegionRegressionDemand(): {
  demand: PreparationDemand
  customerRegionById: Record<string, string>
} {
  const loadRegions: Array<{
    recipeId: string
    regions: Array<[regionId: string, servings: number]>
  }> = [
    { recipeId: 'load-01', regions: [['east-harbor', 10]] },
    {
      recipeId: 'load-02',
      regions: [
        ['east-harbor', 3],
        ['tranquil-fountain', 5],
      ],
    },
    {
      recipeId: 'load-03',
      regions: [
        ['east-harbor', 3],
        ['tranquil-fountain', 1],
      ],
    },
    {
      recipeId: 'load-04',
      regions: [
        ['east-harbor', 1],
        ['tranquil-fountain', 3],
      ],
    },
    { recipeId: 'load-05', regions: [['east-harbor', 4]] },
    {
      recipeId: 'load-06',
      regions: [
        ['east-harbor', 1],
        ['tranquil-fountain', 1],
      ],
    },
    { recipeId: 'load-07', regions: [['tranquil-fountain', 2]] },
    { recipeId: 'load-08', regions: [['east-harbor', 2]] },
    {
      recipeId: 'load-09',
      regions: [
        ['east-harbor', 1],
        ['tranquil-fountain', 1],
      ],
    },
    { recipeId: 'load-10', regions: [['east-harbor', 2]] },
    {
      recipeId: 'load-11',
      regions: [
        ['east-harbor', 1],
        ['tranquil-fountain', 1],
      ],
    },
    { recipeId: 'load-12', regions: [['tranquil-fountain', 2]] },
    { recipeId: 'load-13', regions: [['case-c', 2]] },
    {
      recipeId: 'load-14',
      regions: [
        ['tranquil-fountain', 1],
        ['case-c', 1],
      ],
    },
    { recipeId: 'load-15', regions: [['case-c', 2]] },
    { recipeId: 'load-16', regions: [['case-c', 2]] },
    {
      recipeId: 'load-17',
      regions: [
        ['tranquil-fountain', 1],
        ['case-c', 1],
      ],
    },
    { recipeId: 'load-18', regions: [['tranquil-fountain', 2]] },
    { recipeId: 'load-19', regions: [['case-c', 2]] },
    { recipeId: 'load-20', regions: [['tranquil-fountain', 2]] },
    { recipeId: 'load-21', regions: [['case-c', 1]] },
    { recipeId: 'load-22', regions: [['east-harbor', 1]] },
    { recipeId: 'load-23', regions: [['case-c', 1]] },
    { recipeId: 'load-24', regions: [['case-c', 1]] },
  ]

  const customerRegionById: Record<string, string> = {}
  const recipes = loadRegions.map((load) => {
    const customerIds: string[] = []
    for (const [regionId, servings] of load.regions) {
      for (let index = 0; index < servings; index += 1) {
        const customerId =
          `${load.recipeId}-${regionId}-${index + 1}`
        customerIds.push(customerId)
        customerRegionById[customerId] = regionId
      }
    }

    const productionUnits = Math.ceil(customerIds.length / 2)
    const producedServings = productionUnits * 2

    return {
      recipeId: load.recipeId,
      recipeName: load.recipeId,
      customerIds,
      ingredientIds: [],
      productionUnits,
      producedServings,
      assignedServings: customerIds.length,
      leftoverServings: producedServings - customerIds.length,
      ingredientUnitsPerJuiceUnit: [],
    }
  })
  const assignedServings = recipes.reduce(
    (sum, recipe) => sum + recipe.assignedServings,
    0,
  )
  const producedServings = recipes.reduce(
    (sum, recipe) => sum + recipe.producedServings,
    0,
  )

  return {
    demand: {
      ingredients: [],
      productionWaterUnits: recipes.length,
      cleanCupUses: assignedServings,
      producedServings,
      assignedServings,
      leftoverServings: producedServings - assignedServings,
      recipes,
    },
    customerRegionById,
  }
}

function assignmentPairs(
  plan: RegionPhysicalSalesPlan,
): string[] {
  return plan.regionServiceIntent.customerAssignments
    .map(({ recipeId, customerId }) => `${recipeId}:${customerId}`)
    .sort()
}

describe('region physical sales planner', () => {
  it('uses Region grouping to reduce repeated remote travel while the physical scheduler keeps jar continuation authoritative', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: ['east-a', 'ibex-a'],
      },
      {
        recipeId: 'b',
        recipeName: 'B',
        customerIds: ['east-b', 'ibex-b'],
      },
    ])
    const jars: JuiceJarInventoryItem[] = [
      { id: 'jar-1', recipeId: null, servings: 0 },
      { id: 'jar-2', recipeId: null, servings: 0 },
    ]
    const stock = inventory(jars, 2)
    const shortfall = buildPreparationShortfall(
      salesDemand,
      stock,
      { finishedJuiceJarIds: jars.map((jar) => jar.id) },
    )

    const plan = buildRegionPhysicalSalesPlan({
      demand: salesDemand,
      shortfall,
      policy: 'retain-and-wash',
      availableJuiceJarInventory: jars,
      cups: { cleanCups: 2, usedCups: 0 },
      carryPolicy: {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
      allowDiscardRetainedJuice: false,
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
      customerRegionById: {
        'east-a': 'east-harbor',
        'east-b': 'east-harbor',
        'ibex-a': 'ibex-statue',
        'ibex-b': 'ibex-statue',
      },
    })

    expect(plan.routeCost).toBe(4)
    expect(plan.tripCount).toBe(2)
    expect(plan.serviceFragmentation).toBe(0)
    expect(plan.salesPlan.productionJarFills).toHaveLength(2)
    expect(
      plan.salesPlan.productionJarFills.every(
        (fill) => fill.beforeTripNumber === 1,
      ),
    ).toBe(true)

    const localTrip = plan.trips.find((trip) =>
      trip.servicedRegionIds.includes('east-harbor'),
    )
    const remoteTrip = plan.trips.find((trip) =>
      trip.servicedRegionIds.includes('ibex-statue'),
    )

    expect(localTrip?.servicedRegionIds).toEqual(['east-harbor'])
    expect(remoteTrip?.servicedRegionIds).toEqual(['ibex-statue'])
    expect(
      localTrip?.physicalTrip.juiceJars.map((load) => load.servings),
    ).toEqual([1, 1])
    expect(
      remoteTrip?.physicalTrip.juiceJars.every(
        (load) =>
          load.fillAction === 'continue-loaded' &&
          load.plannedFillServings === 0,
      ),
    ).toBe(true)
  })

  it('preserves same-recipe prefill timing and continues the same persistent jar across Region trips', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: ['east-a', 'ibex-a'],
      },
    ])
    const jars: JuiceJarInventoryItem[] = [
      { id: 'jar-1', recipeId: 'a', servings: 1 },
    ]
    const stock = inventory(jars, 1)
    const shortfall = buildPreparationShortfall(
      salesDemand,
      stock,
      { finishedJuiceJarIds: ['jar-1'] },
    )

    const plan = buildRegionPhysicalSalesPlan({
      demand: salesDemand,
      shortfall,
      policy: 'retain-and-wash',
      availableJuiceJarInventory: jars,
      cups: { cleanCups: 1, usedCups: 0 },
      carryPolicy: {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
      allowDiscardRetainedJuice: false,
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
      customerRegionById: {
        'east-a': 'east-harbor',
        'ibex-a': 'ibex-statue',
      },
    })

    expect(plan.salesPlan.tripCount).toBe(2)
    expect(plan.salesPlan.productionJarFills).toEqual([
      expect.objectContaining({
        physicalJarId: 'jar-1',
        recipeId: 'a',
        beforeTripNumber: 1,
        servings: 2,
        servingsAfterFill: 3,
        fillAction: 'refill-same-type',
      }),
    ])
    expect(plan.salesPlan.trips[0]?.juiceJars[0]).toMatchObject({
      physicalJarId: 'jar-1',
      recipeId: 'a',
      servings: 1,
      plannedFillServings: 2,
      fillAction: 'refill-same-type',
    })
    expect(plan.salesPlan.trips[1]?.juiceJars[0]).toMatchObject({
      physicalJarId: 'jar-1',
      recipeId: 'a',
      servings: 1,
      plannedFillServings: 0,
      fillAction: 'continue-loaded',
    })
    expect(plan.salesPlan.leftoverJarContents).toEqual([
      {
        physicalJarId: 'jar-1',
        recipeId: 'a',
        recipeName: 'A',
        servings: 1,
        tripNumber: 2,
      },
    ])
  })


  it('realizes the 64-cup Region regression by leaving meaningful trips underfilled', () => {
    const fixture = playerRegionRegressionDemand()
    const jars: JuiceJarInventoryItem[] = Array.from(
      { length: 4 },
      (_, index) => ({
        id: `jar-${index + 1}`,
        recipeId: null,
        servings: 0,
      }),
    )
    const stock = inventory(jars, 20)
    const shortfall = buildPreparationShortfall(
      fixture.demand,
      stock,
      { finishedJuiceJarIds: jars.map((jar) => jar.id) },
    )

    const plan = buildRegionPhysicalSalesPlan({
      demand: fixture.demand,
      shortfall,
      policy: 'retain-and-wash',
      availableJuiceJarInventory: jars,
      cups: { cleanCups: 20, usedCups: 0 },
      carryPolicy: {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
      allowDiscardRetainedJuice: false,
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
            to: 'case-c',
            cost: 1,
          },
        ],
      },
      customerRegionById: fixture.customerRegionById,
    })

    const servedCustomerIds = plan.salesPlan.trips.flatMap((trip) =>
      trip.juiceJars.flatMap((load) => load.customerIds),
    )
    const expectedCustomerIds = Object.keys(
      fixture.customerRegionById,
    )

    expect(fixture.demand.assignedServings).toBe(64)
    expect(plan.salesPlan.totalAssignedServings).toBe(64)
    expect(new Set(servedCustomerIds).size).toBe(64)
    expect([...servedCustomerIds].sort()).toEqual(
      [...expectedCustomerIds].sort(),
    )
    if (plan.routeCost !== 16 || plan.tripCount !== 8) {
      throw new Error(
        JSON.stringify(
          {
            routeCost: plan.routeCost,
            tripCount: plan.tripCount,
            fragmentation: plan.serviceFragmentation,
            trips: plan.trips.map((trip) => ({
              tripNumber: trip.tripNumber,
              routeCost: trip.routeCost,
              servicedRegionIds: trip.servicedRegionIds,
              totalServings: trip.physicalTrip.totalServings,
              loads: trip.physicalTrip.juiceJars.map((load) => ({
                recipeId: load.recipeId,
                physicalJarId: load.physicalJarId,
                servings: load.servings,
                fillAction: load.fillAction,
                plannedFillServings: load.plannedFillServings,
                regions: load.customerIds.map(
                  (customerId) =>
                    fixture.customerRegionById[customerId],
                ),
              })),
            })),
          },
          null,
          2,
        ),
      )
    }
    expect(
      plan.salesPlan.trips.some((trip) =>
        trip.juiceJars.some(
          (load) =>
            load.fillAction === 'continue-loaded' &&
            load.plannedFillServings === 0,
        ),
      ),
    ).toBe(true)
    expect(
      plan.salesPlan.leftoverJarContents
        .map((leftover) => leftover.servings)
        .sort((a, b) => a - b),
    ).toEqual([1, 1, 1, 1])
    expect(plan.salesPlan.totalLeftoverServings).toBe(4)
    expect(plan.salesPlan.discardedInitialJuice).toEqual([])
    expect(plan.salesPlan.discardedNewProductionJuice).toEqual([])
    expect(
      plan.salesPlan.trips
        .flatMap((trip) => trip.juiceJars)
        .every((load) =>
          jars.some((jar) => jar.id === load.physicalJarId),
        ),
    ).toBe(true)
  })

  it('keeps recipe-to-customer assignment invariant when only the active workshop changes', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: ['east-a', 'ibex-a'],
      },
      {
        recipeId: 'b',
        recipeName: 'B',
        customerIds: ['east-b', 'ibex-b'],
      },
    ])
    const jars: JuiceJarInventoryItem[] = [
      { id: 'jar-1', recipeId: null, servings: 0 },
      { id: 'jar-2', recipeId: null, servings: 0 },
    ]
    const stock = inventory(jars, 2)
    const shortfall = buildPreparationShortfall(
      salesDemand,
      stock,
      { finishedJuiceJarIds: jars.map((jar) => jar.id) },
    )
    const shared = {
      demand: salesDemand,
      shortfall,
      policy: 'retain-and-wash' as const,
      availableJuiceJarInventory: jars,
      cups: { cleanCups: 2, usedCups: 0 },
      carryPolicy: {
        mode: 'auto' as const,
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
      allowDiscardRetainedJuice: false,
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
      customerRegionById: {
        'east-a': 'east-harbor',
        'east-b': 'east-harbor',
        'ibex-a': 'ibex-statue',
        'ibex-b': 'ibex-statue',
      },
    }

    const fromEast = buildRegionPhysicalSalesPlan({
      ...shared,
      activeWorkshop: {
        id: 'workshop:east-harbor',
        regionId: 'east-harbor',
      },
    })
    const fromIbex = buildRegionPhysicalSalesPlan({
      ...shared,
      activeWorkshop: {
        id: 'workshop:ibex-statue',
        regionId: 'ibex-statue',
      },
    })

    expect(assignmentPairs(fromEast)).toEqual(assignmentPairs(fromIbex))
    expect(assignmentPairs(fromEast)).toEqual([
      'a:east-a',
      'a:ibex-a',
      'b:east-b',
      'b:ibex-b',
    ])

    expect(fromEast.activeWorkshop.regionId).toBe('east-harbor')
    expect(fromIbex.activeWorkshop.regionId).toBe('ibex-statue')
    expect(fromEast.routeCost).toBe(4)
    expect(fromIbex.routeCost).toBe(4)
  })
})
