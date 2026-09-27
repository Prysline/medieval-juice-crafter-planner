import { describe, expect, it } from 'vitest'
import type {
  InventoryState,
  JuiceJarInventoryItem,
} from '../types'
import type { PreparationDemand } from './preparationDemand'
import { buildPreparationShortfall } from './preparationShortfall'
import {
  buildMultiTripReplenishmentPlan,
  type FixedCustomerTripConstraint,
} from './multiTripReplenishment'
import {
  buildCustomSalesTripBaseline,
  moveCustomTripCustomers,
  reorderCustomSalesTrips,
} from './customSalesTripPlan'
import { validateCustomTripPhysicalPlan } from './customTripPhysicalPlanner'

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
    productionWaterUnits: 0,
    cleanCupUses: assignedServings,
    producedServings: assignedServings,
    assignedServings,
    leftoverServings: 0,
    recipes: recipes.map((recipe) => ({
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
      customerIds: [...recipe.customerIds],
      ingredientIds: [],
      productionUnits: Math.ceil(recipe.customerIds.length / 2),
      producedServings: recipe.customerIds.length,
      assignedServings: recipe.customerIds.length,
      leftoverServings: 0,
      ingredientUnitsPerJuiceUnit: [],
    })),
  }
}

function jars(count: number): JuiceJarInventoryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `jar-${index + 1}`,
    recipeId: null,
    servings: 0,
  }))
}

function shortfall(
  salesDemand: PreparationDemand,
  availableJars: JuiceJarInventoryItem[],
) {
  const inventory: InventoryState = {
    ingredientUnits: {},
    waterUnits: 0,
    cleanCups: 0,
    usedCups: 0,
    juiceJars: availableJars,
    shelfCount: 0,
    jarRackCount: 0,
  }

  return buildPreparationShortfall(
    salesDemand,
    inventory,
    {
      finishedJuiceJarIds: availableJars.map((jar) => jar.id),
    },
  )
}

function fixedPlan(
  salesDemand: PreparationDemand,
  fixedCustomerTrips: readonly FixedCustomerTripConstraint[],
  availableJarCount: number,
  cleanCups = salesDemand.assignedServings,
) {
  const availableJars = jars(availableJarCount)
  return buildMultiTripReplenishmentPlan(
    salesDemand,
    'retain-and-wash',
    availableJars,
    { cleanCups, usedCups: 0 },
    shortfall(salesDemand, availableJars),
    {
      mode: 'auto',
      reservedSlots: 0,
      minimumCarriedSlots: 0,
    },
    false,
    { fixedCustomerTrips },
  )
}

describe('fixed customer trip physical realization', () => {
  it('keeps a player-fixed two-trip grouping even when all customers could fit in one automatic trip', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: ['a-1', 'a-2'],
      },
      {
        recipeId: 'b',
        recipeName: 'B',
        customerIds: ['b-1', 'b-2'],
      },
    ])

    const plan = fixedPlan(
      salesDemand,
      [
        { customerIds: ['a-1', 'b-1'] },
        { customerIds: ['a-2', 'b-2'] },
      ],
      2,
    )

    expect(plan.trips).toHaveLength(2)
    expect(
      plan.trips.map((trip) =>
        trip.juiceJars
          .flatMap((load) => load.customerIds)
          .sort(),
      ),
    ).toEqual([
      ['a-1', 'b-1'],
      ['a-2', 'b-2'],
    ])
    expect(
      plan.trips[1]?.juiceJars.every(
        (load) =>
          load.fillAction === 'continue-loaded' ||
          load.plannedFillServings >= 0,
      ),
    ).toBe(true)
  })

  it('keeps matching initial jar contents across player-fixed trips with continue-loaded', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: ['a-1', 'a-2', 'a-3', 'a-4'],
      },
    ])
    const availableJars: JuiceJarInventoryItem[] = [
      {
        id: 'jar-1',
        recipeId: 'a',
        servings: 4,
      },
    ]
    const plan = buildMultiTripReplenishmentPlan(
      salesDemand,
      'retain-and-wash',
      availableJars,
      { cleanCups: 4, usedCups: 0 },
      shortfall(salesDemand, availableJars),
      {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
      false,
      {
        fixedCustomerTrips: [
          { customerIds: ['a-1', 'a-2'] },
          { customerIds: ['a-3', 'a-4'] },
        ],
      },
    )

    expect(plan.productionJarFills).toEqual([])
    expect(plan.trips).toHaveLength(2)
    expect(plan.trips[0]?.juiceJars[0]).toMatchObject({
      physicalJarId: 'jar-1',
      recipeId: 'a',
      customerIds: ['a-1', 'a-2'],
      servings: 2,
      plannedFillServings: 0,
      fillAction: 'use-existing',
      retainedLeftoverServings: 2,
    })
    expect(plan.trips[1]?.juiceJars[0]).toMatchObject({
      physicalJarId: 'jar-1',
      recipeId: 'a',
      customerIds: ['a-3', 'a-4'],
      servings: 2,
      plannedFillServings: 0,
      fillAction: 'continue-loaded',
    })
  })

  it('uses the player-fixed trip order when one jar must switch recipes between trips', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: ['a-1', 'a-2'],
      },
      {
        recipeId: 'b',
        recipeName: 'B',
        customerIds: ['b-1', 'b-2'],
      },
    ])

    const plan = fixedPlan(
      salesDemand,
      [
        { customerIds: ['b-1', 'b-2'] },
        { customerIds: ['a-1', 'a-2'] },
      ],
      1,
    )

    expect(
      plan.trips.map((trip) =>
        trip.juiceJars.flatMap((load) => load.customerIds),
      ),
    ).toEqual([
      ['b-1', 'b-2'],
      ['a-1', 'a-2'],
    ])
    expect(plan.jarTypeSwitches).toBe(1)
  })

  it('reports the exact fixed trip when the requested group cannot fit in one physical trip', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: Array.from(
          { length: 12 },
          (_, index) => `a-${index + 1}`,
        ),
      },
    ])

    expect(() =>
      fixedPlan(
        salesDemand,
        [
          {
            customerIds: salesDemand.recipes[0]!.customerIds,
          },
        ],
        1,
      ),
    ).toThrow(/Fixed trip 1 could not be realized exactly/)
  })

  it('keeps the existing soft preference semantics separate from the fixed-trip authority', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: Array.from(
          { length: 12 },
          (_, index) => `a-${index + 1}`,
        ),
      },
    ])
    const availableJars = jars(1)
    const preference = Object.fromEntries(
      salesDemand.recipes[0]!.customerIds.map(
        (customerId) => [customerId, 1],
      ),
    )

    const plan = buildMultiTripReplenishmentPlan(
      salesDemand,
      'retain-and-wash',
      availableJars,
      { cleanCups: 12, usedCups: 0 },
      shortfall(salesDemand, availableJars),
      {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
      false,
      { customerTripPreferenceById: preference },
    )

    expect(plan.trips).toHaveLength(2)
    expect(
      plan.trips.map((trip) => trip.totalServings),
    ).toEqual([10, 2])
  })

  it('rejects an attempt to combine soft preferences with fixed trips', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: ['a-1'],
      },
    ])
    const availableJars = jars(1)

    expect(() =>
      buildMultiTripReplenishmentPlan(
        salesDemand,
        'retain-and-wash',
        availableJars,
        { cleanCups: 1, usedCups: 0 },
        shortfall(salesDemand, availableJars),
        undefined,
        false,
        {
          customerTripPreferenceById: { 'a-1': 1 },
          fixedCustomerTrips: [
            { customerIds: ['a-1'] },
          ],
        },
      ),
    ).toThrow(/mutually exclusive/)
  })
})

describe('custom trip physical validation adapter', () => {
  it('returns the realized physical plan for a valid custom regrouping and order', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: ['a-1', 'a-2'],
      },
      {
        recipeId: 'b',
        recipeName: 'B',
        customerIds: ['b-1', 'b-2'],
      },
    ])
    const availableJars = jars(2)
    const baselinePhysical = fixedPlan(
      salesDemand,
      [
        { customerIds: ['a-1', 'a-2'] },
        { customerIds: ['b-1', 'b-2'] },
      ],
      2,
    )
    const baseline = buildCustomSalesTripBaseline({
      recipeAssignments: salesDemand.recipes.map(
        (recipe) => ({
          recipeId: recipe.recipeId,
          customerIds: recipe.customerIds,
        }),
      ),
      physicalTrips: baselinePhysical.trips,
      customerRegionById: {
        'a-1': 'east-harbor',
        'a-2': 'east-harbor',
        'b-1': 'tranquil-fountain',
        'b-2': 'tranquil-fountain',
      },
    })
    const regrouped = moveCustomTripCustomers(
      baseline,
      ['b-1'],
      baseline.tripOrder[0]!,
    )
    const customPlan = reorderCustomSalesTrips(
      regrouped,
      [...regrouped.tripOrder].reverse(),
    )

    const result = validateCustomTripPhysicalPlan({
      customPlan,
      demand: salesDemand,
      shortfall: shortfall(salesDemand, availableJars),
      policy: 'retain-and-wash',
      availableJuiceJarInventory: availableJars,
      cups: { cleanCups: 4, usedCups: 0 },
      carryPolicy: {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
    })

    expect(result.status).toBe('valid')
    if (result.status !== 'valid') return
    expect(result.salesPlan.trips).toHaveLength(2)
    expect(
      result.salesPlan.trips.map((trip) =>
        trip.juiceJars
          .flatMap((load) => load.customerIds)
          .sort(),
      ),
    ).toEqual(
      customPlan.tripOrder.map((tripId) =>
        Object.keys(customPlan.customersById)
          .filter(
            (customerId) =>
              customPlan.tripByCustomerId[customerId] === tripId,
          )
          .sort(),
      ),
    )
  })

  it('maps a fixed-trip realization failure back to the stable custom trip ID', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        customerIds: Array.from(
          { length: 12 },
          (_, index) => `a-${index + 1}`,
        ),
      },
    ])
    const availableJars = jars(1)
    const autoPhysical = buildMultiTripReplenishmentPlan(
      salesDemand,
      'retain-and-wash',
      availableJars,
      { cleanCups: 12, usedCups: 0 },
      shortfall(salesDemand, availableJars),
      {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
    )
    const customPlan = buildCustomSalesTripBaseline({
      recipeAssignments: [
        {
          recipeId: 'a',
          customerIds: salesDemand.recipes[0]!.customerIds,
        },
      ],
      physicalTrips: [
        {
          tripNumber: 1,
          juiceJars: [
            {
              recipeId: 'a',
              customerIds:
                salesDemand.recipes[0]!.customerIds,
            },
          ],
        },
      ],
      customerRegionById: Object.fromEntries(
        salesDemand.recipes[0]!.customerIds.map(
          (customerId) => [
            customerId,
            'east-harbor',
          ],
        ),
      ),
    })

    expect(autoPhysical.trips).toHaveLength(2)

    const result = validateCustomTripPhysicalPlan({
      customPlan,
      demand: salesDemand,
      shortfall: shortfall(salesDemand, availableJars),
      policy: 'retain-and-wash',
      availableJuiceJarInventory: availableJars,
      cups: { cleanCups: 12, usedCups: 0 },
      carryPolicy: {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
    })

    expect(result).toMatchObject({
      status: 'invalid',
      salesPlan: null,
      issues: [
        {
          category: 'physical-realization',
          tripId: 'auto-trip-1',
          recipeId: 'a',
        },
      ],
    })
  })
})
