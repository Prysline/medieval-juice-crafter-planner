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

    expect(fromEast.trips[0].servicedRegionIds).toEqual(['east-harbor'])
    expect(fromIbex.trips[0].servicedRegionIds).toEqual(['ibex-statue'])
  })
})
