import { describe, expect, it } from 'vitest'
import type { PreparationDemand } from './preparationDemand'
import {
  buildMultiTripReplenishmentPlan,
  countJarTypeSwitchesFromSchedule,
  type MultiTripReplenishmentPlan,
  type UsedCupTripPolicy,
} from './multiTripReplenishment'

function demand(
  recipes: Array<{
    recipeId: string
    recipeName: string
    assignedServings: number
  }>,
): PreparationDemand {
  const assignedServings = recipes.reduce(
    (sum, recipe) => sum + recipe.assignedServings,
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
      ...recipe,
      customerIds: Array.from(
        { length: recipe.assignedServings },
        (_, index) => `${recipe.recipeId}-customer-${index + 1}`,
      ),
      ingredientIds: [],
      productionUnits: Math.ceil(
        recipe.assignedServings / 2,
      ),
      producedServings: recipe.assignedServings,
      leftoverServings: 0,
      ingredientUnitsPerJuiceUnit: [],
    })),
  }
}

function namedRecipes(
  names: string[],
  assignedServings = 10,
): PreparationDemand {
  return demand(
    names.map((name) => ({
      recipeId: name.toLowerCase(),
      recipeName: name,
      assignedServings,
    })),
  )
}

function expectScheduleConsistency(
  result: MultiTripReplenishmentPlan,
): void {
  expect(result.trips).toHaveLength(result.tripCount)
  expect(
    countJarTypeSwitchesFromSchedule(result.trips),
  ).toBe(result.jarTypeSwitches)
  expect(
    result.trips.every(
      (trip) =>
        new Set(
          trip.juiceJars.map(
            (load) => load.physicalJarId,
          ),
        ).size === trip.juiceJars.length,
    ),
  ).toBe(true)
  expect(
    result.trips.every((trip) =>
      trip.juiceJars.every(
        (load) => load.customerIds.length === load.servings,
      ),
    ),
  ).toBe(true)
  const servedCustomerIds = result.trips.flatMap((trip) =>
    trip.juiceJars.flatMap((load) => load.customerIds),
  )
  expect(new Set(servedCustomerIds).size).toBe(
    servedCustomerIds.length,
  )
  expect(servedCustomerIds).toHaveLength(
    result.totalAssignedServings,
  )
}

describe('multi-trip replenishment', () => {
  it('reuses one physical jar across four juice types and records three switches', () => {
    const result = buildMultiTripReplenishmentPlan(
      namedRecipes(['A', 'B', 'C', 'D'], 1),
      'allow-drop-if-full',
      1,
    )

    expect(result.tripCount).toBe(4)
    expect(result.physicalJarsUsed).toBe(1)
    expect(result.maxJuiceJarSlotsCarried).toBe(1)
    expect(result.jarTypeSwitches).toBe(3)
    expect(
      result.trips.flatMap((trip) =>
        trip.juiceJars.map(
          (load) => load.physicalJarId,
        ),
      ),
    ).toEqual([1, 1, 1, 1])
    expect(
      result.trips.flatMap((trip) =>
        trip.juiceJars.flatMap((load) => load.customerIds),
      ),
    ).toEqual([
      'a-customer-1',
      'b-customer-1',
      'c-customer-1',
      'd-customer-1',
    ])
    expect(
      result.trips.flatMap((trip) =>
        trip.juiceJars.map(
          (load) => load.fillAction,
        ),
      ),
    ).toEqual([
      'initial-fill',
      'type-switch',
      'type-switch',
      'type-switch',
    ])
    expectScheduleConsistency(result)
  })

  it('uses two physical jars for four juice types in two trips with two switches', () => {
    const result = buildMultiTripReplenishmentPlan(
      namedRecipes(['A', 'B', 'C', 'D'], 1),
      'allow-drop-if-full',
      2,
    )

    expect(result.tripCount).toBe(2)
    expect(
      result.trips.map(
        (trip) => trip.juiceJars.length,
      ),
    ).toEqual([2, 2])
    expect(result.jarTypeSwitches).toBe(2)
    expect(
      result.trips[0].juiceJars.map(
        (load) => load.fillAction,
      ),
    ).toEqual(['initial-fill', 'initial-fill'])
    expect(
      result.trips[1].juiceJars.map(
        (load) => load.fillAction,
      ),
    ).toEqual(['type-switch', 'type-switch'])
    expectScheduleConsistency(result)
  })

  it('requires multiple trips but no switch when one jar refills the same juice type', () => {
    const result = buildMultiTripReplenishmentPlan(
      namedRecipes(['A'], 15),
      'allow-drop-if-full',
      1,
    )

    expect(result.tripCount).toBe(2)
    expect(result.jarTypeSwitches).toBe(0)
    expect(result.trips[0].juiceJars[0]).toMatchObject({
      physicalJarId: 1,
      servings: 10,
      fillAction: 'initial-fill',
    })
    expect(result.trips[1].juiceJars[0]).toMatchObject({
      physicalJarId: 1,
      servings: 5,
      fillAction: 'refill-same-type',
    })
    expectScheduleConsistency(result)
  })

  it('limits concurrent carried jars by backpack capacity instead of a global rack constant', () => {
    const result = buildMultiTripReplenishmentPlan(
      namedRecipes(['A', 'B', 'C', 'D', 'E', 'F']),
      'allow-drop-if-full',
      8,
    )

    expect(result.carriedJuiceJarCount).toBe(8)
    expect(result.physicalJarsUsed).toBe(6)
    expect(result.tripCount).toBe(3)
    expect(result.trips[0].juiceJars).toHaveLength(2)
    expect(result.maxJuiceJarSlotsCarried).toBe(8)
    expect(result.jarTypeSwitches).toBe(0)
    expectScheduleConsistency(result)
  })

  it('limits each trip to the configured carried jar count', () => {
    const result = buildMultiTripReplenishmentPlan(
      namedRecipes(['A', 'B', 'C', 'D']),
      'allow-drop-if-full',
      2,
    )

    expect(result.tripCount).toBe(2)
    expect(result.maxJuiceJarSlotsCarried).toBe(2)
    expect(
      result.trips.every(
        (trip) => trip.juiceJars.length <= 2,
      ),
    ).toBe(true)
    expect(result.jarTypeSwitches).toBe(2)
    expectScheduleConsistency(result)
  })

  it('preserves different trip counts for the two used-cup policies', () => {
    const salesDemand = namedRecipes([
      'A',
      'B',
      'C',
      'D',
      'E',
    ])
    const retained = buildMultiTripReplenishmentPlan(
      salesDemand,
      'retain-and-wash',
      5,
    )
    const droppable = buildMultiTripReplenishmentPlan(
      salesDemand,
      'allow-drop-if-full',
      5,
    )

    expect(retained.tripCount).toBe(2)
    expect(retained.trips[0]).toMatchObject({
      totalServings: 40,
      departureSlots: 9,
      effectiveDepartureSlotLimit: 9,
      reservedTransientUsedCupSlot: 1,
      usedCupDropMayOccur: false,
      juiceJarSlotsCarried: 5,
    })
    expect(retained.reusableCleanCupPoolSize).toBe(40)
    expect(retained.betweenTripWashWaterUnits).toBe(40)

    expect(droppable.tripCount).toBe(1)
    expect(droppable.trips[0]).toMatchObject({
      totalServings: 50,
      departureSlots: 10,
      effectiveDepartureSlotLimit: 10,
      reservedTransientUsedCupSlot: 0,
      usedCupDropMayOccur: true,
      juiceJarSlotsCarried: 5,
    })
    expect(
      droppable.reusableCleanCupPoolSize,
    ).toBeNull()
    expect(droppable.betweenTripWashWaterUnits).toBe(0)

    expectScheduleConsistency(retained)
    expectScheduleConsistency(droppable)
  })

  it('can keep a multi-load same-type demand in one trip when enough physical jars exist', () => {
    const result = buildMultiTripReplenishmentPlan(
      demand([
        {
          recipeId: 'lemon',
          recipeName: '檸檬汁',
          assignedServings: 12,
        },
        {
          recipeId: 'orange',
          recipeName: '橙汁',
          assignedServings: 6,
        },
      ]),
      'retain-and-wash',
      3,
    )

    expect(result.tripCount).toBe(1)
    expect(result.trips[0]).toMatchObject({
      totalServings: 18,
      cleanCupStacks: 2,
      cleanCupsCarried: 18,
      departureSlots: 5,
      effectiveDepartureSlotLimit: 9,
      reservedTransientUsedCupSlot: 1,
      usedCupDropMayOccur: false,
      juiceJarSlotsCarried: 3,
    })
    expect(result.jarTypeSwitches).toBe(0)
    expect(result.reusableCleanCupPoolSize).toBe(18)
    expect(result.betweenTripWashWaterUnits).toBe(0)
    expectScheduleConsistency(result)
  })

  it('can make drop policy feasible when retain-and-wash is not', () => {
    const salesDemand = namedRecipes(['A'], 1)

    expect(() =>
      buildMultiTripReplenishmentPlan(
        salesDemand,
        'retain-and-wash',
        9,
      ),
    ).toThrow('A single jar cannot fit the retain-and-wash trip policy')

    const droppable = buildMultiTripReplenishmentPlan(
      salesDemand,
      'allow-drop-if-full',
      9,
    )
    expect(droppable.tripCount).toBe(1)
    expect(droppable.trips[0]).toMatchObject({
      totalServings: 1,
      departureSlots: 10,
      usedCupDropMayOccur: true,
      juiceJarSlotsCarried: 9,
    })
  })

  it('rejects positive sales demand when no jar is carried', () => {
    expect(() =>
      buildMultiTripReplenishmentPlan(
        namedRecipes(['A'], 1),
        'retain-and-wash',
        0,
      ),
    ).toThrow(
      'Sales planning requires at least one carried physical juice jar',
    )
  })

  it.each<UsedCupTripPolicy>([
    'retain-and-wash',
    'allow-drop-if-full',
  ])(
    'returns an empty plan for zero demand under %s',
    (policy) => {
      const result = buildMultiTripReplenishmentPlan(
        demand([]),
        policy,
        2,
      )

      expect(result).toEqual({
        policy,
        carriedJuiceJarCount: 2,
        physicalJarsUsed: 0,
        totalJarLoads: 0,
        distinctFinalJuiceTypes: 0,
        jarTypeSwitches: 0,
        trips: [],
        tripCount: 0,
        totalAssignedServings: 0,
        maxJuiceJarSlotsCarried: 0,
        cleanCupUnitsRequiredWithoutMiddayWashing: 0,
        reusableCleanCupPoolSize:
          policy === 'retain-and-wash' ? 0 : null,
        betweenTripWashWaterUnits: 0,
        returnsHomeBetweenTrips: false,
      })
      expectScheduleConsistency(result)
    },
  )
})
