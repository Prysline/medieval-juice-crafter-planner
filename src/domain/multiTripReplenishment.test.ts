import { describe, expect, it } from 'vitest'
import type { InventoryState, JuiceJarInventoryItem } from '../types'
import type { PreparationDemand } from './preparationDemand'
import { buildPreparationShortfall } from './preparationShortfall'
import {
  buildMultiTripReplenishmentPlan as buildMultiTripReplenishmentPlanWithCups,
  countJarTypeSwitchesFromSchedule,
  type MultiTripReplenishmentPlan,
  type UsedCupTripPolicy,
} from './multiTripReplenishment'

function demand(
  recipes: Array<{
    recipeId: string
    recipeName: string
    assignedServings: number
    leftoverServings?: number
  }>,
): PreparationDemand {
  const assignedServings = recipes.reduce(
    (sum, recipe) => sum + recipe.assignedServings,
    0,
  )
  const leftoverServings = recipes.reduce(
    (sum, recipe) => sum + (recipe.leftoverServings ?? 0),
    0,
  )

  return {
    ingredients: [],
    productionWaterUnits: 0,
    cleanCupUses: assignedServings,
    producedServings: assignedServings + leftoverServings,
    assignedServings,
    leftoverServings,
    recipes: recipes.map((recipe) => {
      const recipeLeftovers = recipe.leftoverServings ?? 0
      const producedServings =
        recipe.assignedServings + recipeLeftovers
      return {
        ...recipe,
        leftoverServings: recipeLeftovers,
        customerIds: Array.from(
          { length: recipe.assignedServings },
          (_, index) => `${recipe.recipeId}-customer-${index + 1}`,
        ),
        ingredientIds: [],
        productionUnits: Math.ceil(producedServings / 2),
        producedServings,
        ingredientUnitsPerJuiceUnit: [],
      }
    }),
  }
}

function carriedJars(count: number): JuiceJarInventoryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `jar-${index + 1}`,
    recipeId: null,
    servings: 0,
  }))
}

function shortfallFor(
  salesDemand: PreparationDemand,
  jars: JuiceJarInventoryItem[],
) {
  const inventory: InventoryState = {
    ingredientUnits: {},
    waterUnits: 0,
    cleanCups: 0,
    usedCups: 0,
    juiceJars: jars,
    shelfCount: 0,
    jarRackCount: 0,
  }
  return buildPreparationShortfall(
    salesDemand,
    inventory,
    {
      finishedJuiceJarIds: jars.map((jar) => jar.id),
    },
  )
}

function buildPlanWithJars(
  salesDemand: PreparationDemand,
  policy: UsedCupTripPolicy,
  jars: JuiceJarInventoryItem[],
  cups = {
    cleanCups: salesDemand.assignedServings,
    usedCups: 0,
  },
): MultiTripReplenishmentPlan {
  return buildMultiTripReplenishmentPlanWithCups(
    salesDemand,
    policy,
    jars,
    cups,
    shortfallFor(salesDemand, jars),
  )
}

function buildPlan(
  salesDemand: PreparationDemand,
  policy: UsedCupTripPolicy,
  carriedJuiceJarCount: number,
  cups = {
    cleanCups: salesDemand.assignedServings,
    usedCups: 0,
  },
): MultiTripReplenishmentPlan {
  return buildPlanWithJars(
    salesDemand,
    policy,
    carriedJars(carriedJuiceJarCount),
    cups,
  )
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
    countJarTypeSwitchesFromSchedule(
      result.trips,
      result.carriedJuiceJars,
    ),
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
  expect(
    result.leftoverJarContents.reduce(
      (sum, item) => sum + item.servings,
      0,
    ),
  ).toBe(result.totalLeftoverServings)
  expect(
    result.trips.every((trip) =>
      trip.juiceJars.every(
        (load) =>
          load.servings + load.retainedLeftoverServings <= 10,
      ),
    ),
  ).toBe(true)

  for (const item of result.leftoverJarContents) {
    const trip = result.trips.find(
      (candidate) => candidate.tripNumber === item.tripNumber,
    )
    const load = trip?.juiceJars.find(
      (candidate) =>
        candidate.physicalJarId === item.physicalJarId &&
        candidate.recipeId === item.recipeId,
    )
    expect(load?.retainedLeftoverServings).toBeGreaterThanOrEqual(
      item.servings,
    )
  }
}

describe('multi-trip replenishment', () => {
  it('serves matching initial contents from their exact persistent jar without a fill', () => {
    const salesDemand = namedRecipes(['A'], 1)
    const result = buildPlanWithJars(
      salesDemand,
      'allow-drop-if-full',
      [{ id: 'owned-a', recipeId: 'a', servings: 1 }],
      { cleanCups: 1, usedCups: 0 },
    )

    expect(result.carriedJuiceJars).toEqual([
      {
        physicalJarId: 'owned-a',
        initialRecipeId: 'a',
        initialServings: 1,
      },
    ])
    expect(result.trips).toHaveLength(1)
    expect(result.trips[0].juiceJars[0]).toMatchObject({
      physicalJarId: 'owned-a',
      recipeId: 'a',
      customerIds: ['a-customer-1'],
      servings: 1,
      fillAction: 'use-existing',
    })
    expect(result.jarTypeSwitches).toBe(0)
    expectScheduleConsistency(result)
  })

  it('counts a switch only after matching initial contents are fully consumed', () => {
    const salesDemand = namedRecipes(['A', 'B'], 1)
    const result = buildPlanWithJars(
      salesDemand,
      'allow-drop-if-full',
      [{ id: 'owned-a', recipeId: 'a', servings: 1 }],
      { cleanCups: 2, usedCups: 0 },
    )

    expect(result.tripCount).toBe(2)
    expect(
      result.trips.flatMap((trip) =>
        trip.juiceJars.map((load) => ({
          recipeId: load.recipeId,
          fillAction: load.fillAction,
        })),
      ),
    ).toEqual([
      { recipeId: 'a', fillAction: 'use-existing' },
      { recipeId: 'b', fillAction: 'type-switch' },
    ])
    expect(result.jarTypeSwitches).toBe(1)
    expectScheduleConsistency(result)
  })

  it('does not discard retained initial juice to make room for another recipe', () => {
    const salesDemand = namedRecipes(['B'], 1)

    expect(() =>
      buildPlanWithJars(
        salesDemand,
        'retain-and-wash',
        [{ id: 'owned-a', recipeId: 'a', servings: 2 }],
        { cleanCups: 1, usedCups: 0 },
      ),
    ).toThrow(/without discarding retained contents/)
  })

  it('keeps a prefilled unrelated jar locked while an empty jar handles later recipe switches', () => {
    const salesDemand = namedRecipes(['B', 'C'], 2)
    const result = buildPlanWithJars(
      salesDemand,
      'allow-drop-if-full',
      [
        { id: 'locked-a', recipeId: 'a', servings: 2 },
        { id: 'empty', recipeId: null, servings: 0 },
      ],
      { cleanCups: 4, usedCups: 0 },
    )

    expect(result.physicalJarsUsed).toBe(1)
    expect(
      new Set(
        result.trips.flatMap((trip) =>
          trip.juiceJars.map((load) => load.physicalJarId),
        ),
      ),
    ).toEqual(new Set(['empty']))
    expect(result.jarTypeSwitches).toBe(1)
    expectScheduleConsistency(result)
  })

  it('uses the same persistent jar identities for both cup policies', () => {
    const jars: JuiceJarInventoryItem[] = [
      { id: 'persistent-a', recipeId: 'lemon-juice', servings: 2 },
      { id: 'persistent-b', recipeId: null, servings: 0 },
    ]
    const salesDemand = namedRecipes(['A', 'B'], 2)
    const cups = { cleanCups: 4, usedCups: 0 }

    const retain = buildPlanWithJars(
      salesDemand,
      'retain-and-wash',
      jars,
      cups,
    )
    const drop = buildPlanWithJars(
      salesDemand,
      'allow-drop-if-full',
      jars,
      cups,
    )

    expect(retain.carriedJuiceJars).toEqual(drop.carriedJuiceJars)
    expect(
      new Set(
        retain.trips.flatMap((trip) =>
          trip.juiceJars.map((load) => load.physicalJarId),
        ),
      ),
    ).toEqual(
      new Set(
        drop.trips.flatMap((trip) =>
          trip.juiceJars.map((load) => load.physicalJarId),
        ),
      ),
    )
  })

  it('rejects duplicate persistent carried jar IDs', () => {
    expect(() =>
      buildPlanWithJars(
        namedRecipes(['A'], 1),
        'retain-and-wash',
        [
          { id: 'duplicate', recipeId: null, servings: 0 },
          { id: 'duplicate', recipeId: null, servings: 0 },
        ],
        { cleanCups: 1, usedCups: 0 },
      ),
    ).toThrow(/unique persistent inventory IDs/)
  })

  it('reuses one physical jar across four juice types and records three switches', () => {
    const result = buildPlan(
      namedRecipes(['A', 'B', 'C', 'D'], 2),
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
    ).toEqual(['jar-1', 'jar-1', 'jar-1', 'jar-1'])
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
    const result = buildPlan(
      namedRecipes(['A', 'B', 'C', 'D'], 2),
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
    const result = buildPlan(
      namedRecipes(['A'], 15),
      'allow-drop-if-full',
      1,
    )

    expect(result.tripCount).toBe(2)
    expect(result.jarTypeSwitches).toBe(0)
    expect(result.trips[0].juiceJars[0]).toMatchObject({
      physicalJarId: 'jar-1',
      servings: 10,
      fillAction: 'initial-fill',
    })
    expect(result.trips[1].juiceJars[0]).toMatchObject({
      physicalJarId: 'jar-1',
      servings: 5,
      fillAction: 'refill-same-type',
    })
    expectScheduleConsistency(result)
  })

  it('limits concurrent carried jars by backpack capacity instead of a global rack constant', () => {
    const result = buildPlan(
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
    const result = buildPlan(
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
    const retained = buildPlan(
      salesDemand,
      'retain-and-wash',
      5,
    )
    const droppable = buildPlan(
      salesDemand,
      'allow-drop-if-full',
      5,
    )

    expect(retained.tripCount).toBe(2)
    expect(retained.trips[0]).toMatchObject({
      totalServings: 41,
      departureSlots: 10,
      effectiveDepartureSlotLimit: 10,
      reservedTransientUsedCupSlot: 0,
      usedCupDropMayOccur: false,
      droppedUsedCups: 0,
      peakOccupiedSlots: 10,
      juiceJarSlotsCarried: 5,
    })
    expect(retained.reusableCleanCupPoolSize).toBe(41)
    expect(retained.totalCupWashWaterUnits).toBe(0)

    expect(droppable.tripCount).toBe(1)
    expect(droppable.trips[0]).toMatchObject({
      totalServings: 50,
      departureSlots: 10,
      effectiveDepartureSlotLimit: 10,
      reservedTransientUsedCupSlot: 0,
      usedCupDropMayOccur: true,
      droppedUsedCups: 9,
      peakOccupiedSlots: 10,
      juiceJarSlotsCarried: 5,
    })
    expect(droppable.droppedUsedCups).toBe(9)
    expect(droppable.finalPhysicalCupCount).toBe(41)
    expect(
      droppable.reusableCleanCupPoolSize,
    ).toBeNull()
    expect(droppable.totalCupWashWaterUnits).toBe(0)

    expectScheduleConsistency(retained)
    expectScheduleConsistency(droppable)
  })

  it('can keep a multi-load same-type demand in one trip when enough physical jars exist', () => {
    const result = buildPlan(
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
      effectiveDepartureSlotLimit: 10,
      reservedTransientUsedCupSlot: 1,
      usedCupDropMayOccur: false,
      droppedUsedCups: 0,
      peakOccupiedSlots: 6,
      juiceJarSlotsCarried: 3,
    })
    expect(result.jarTypeSwitches).toBe(0)
    expect(result.reusableCleanCupPoolSize).toBe(18)
    expect(result.betweenTripWashWaterUnits).toBe(0)
    expectScheduleConsistency(result)
  })

  it('replaces the fixed retained-cup slot reservation with exact stack transitions', () => {
    const salesDemand = namedRecipes(['A'], 1)

    const retained = buildPlan(
      salesDemand,
      'retain-and-wash',
      9,
    )
    expect(retained.tripCount).toBe(1)
    expect(retained.trips[0]).toMatchObject({
      totalServings: 1,
      departureSlots: 10,
      peakOccupiedSlots: 10,
      reservedTransientUsedCupSlot: 0,
      droppedUsedCups: 0,
      juiceJarSlotsCarried: 9,
    })

    const droppable = buildPlan(
      salesDemand,
      'allow-drop-if-full',
      9,
    )
    expect(droppable.tripCount).toBe(1)
    expect(droppable.trips[0].droppedUsedCups).toBe(0)
  })

  it('washes and reuses a smaller physical cup pool across trips', () => {
    const result = buildPlan(
      namedRecipes(['A'], 15),
      'retain-and-wash',
      1,
      { cleanCups: 5, usedCups: 0 },
    )

    expect(result.tripCount).toBe(3)
    expect(result.trips.map((trip) => trip.totalServings)).toEqual([
      5,
      5,
      5,
    ])
    expect(result.trips.map((trip) => trip.cupsWashedBeforeTrip)).toEqual([
      0,
      5,
      5,
    ])
    expect(result.initialPhysicalCupCount).toBe(5)
    expect(result.finalPhysicalCupCount).toBe(5)
    expect(result.betweenTripWashWaterUnits).toBe(10)
    expect(result.totalCupWashWaterUnits).toBe(10)
    expect(result.droppedUsedCups).toBe(0)
    expectScheduleConsistency(result)
  })

  it('records used cups that actually drop when the backpack has no return slot', () => {
    const result = buildPlan(
      namedRecipes(['A'], 10),
      'allow-drop-if-full',
      9,
      { cleanCups: 10, usedCups: 0 },
    )

    expect(result.tripCount).toBe(1)
    expect(result.trips[0]).toMatchObject({
      totalServings: 10,
      departureSlots: 10,
      peakOccupiedSlots: 10,
      droppedUsedCups: 9,
      usedCupsAfterTrip: 1,
      physicalCupsAfterTrip: 1,
    })
    expect(result.droppedUsedCups).toBe(9)
    expect(result.finalPhysicalCupCount).toBe(1)
    expectScheduleConsistency(result)
  })

  it('rejects positive sales demand when the player owns no physical cups', () => {
    expect(() =>
      buildPlan(
        namedRecipes(['A'], 1),
        'retain-and-wash',
        1,
        { cleanCups: 0, usedCups: 0 },
      ),
    ).toThrow('Sales planning requires at least one physical cup')
  })

  it('rejects positive sales demand when no jar is carried', () => {
    expect(() =>
      buildPlan(
        namedRecipes(['A'], 1),
        'retain-and-wash',
        0,
      ),
    ).toThrow(
      'Sales planning requires at least one carried physical juice jar',
    )
  })

  it('keeps a recipe leftover in the final sales jar', () => {
    const result = buildPlan(
      demand([
        {
          recipeId: 'sweet',
          recipeName: '甜味果汁',
          assignedServings: 3,
          leftoverServings: 1,
        },
      ]),
      'retain-and-wash',
      1,
    )

    expect(result.totalAssignedServings).toBe(3)
    expect(result.totalLeftoverServings).toBe(1)
    expect(result.trips[0].juiceJars[0]).toMatchObject({
      physicalJarId: 'jar-1',
      recipeId: 'sweet',
      servings: 3,
      retainedLeftoverServings: 1,
    })
    expect(result.leftoverJarContents).toEqual([
      {
        physicalJarId: 'jar-1',
        recipeId: 'sweet',
        recipeName: '甜味果汁',
        servings: 1,
        tripNumber: 1,
      },
    ])
    expectScheduleConsistency(result)
  })

  it('orders a leftover recipe last when that preserves it without an extra type switch', () => {
    const result = buildPlan(
      demand([
        {
          recipeId: 'a',
          recipeName: 'A',
          assignedServings: 1,
          leftoverServings: 1,
        },
        {
          recipeId: 'b',
          recipeName: 'B',
          assignedServings: 2,
        },
      ]),
      'retain-and-wash',
      1,
    )

    expect(result.jarTypeSwitches).toBe(1)
    expect(
      result.trips.flatMap((trip) =>
        trip.juiceJars.map((load) => load.recipeId),
      ),
    ).toEqual(['b', 'a'])
    const finalLoad = result.trips
      .flatMap((trip) => trip.juiceJars)
      .at(-1)
    expect(finalLoad).toMatchObject({
      physicalJarId: 'jar-1',
      recipeId: 'a',
      retainedLeftoverServings: 1,
    })
    expect(result.leftoverJarContents).toMatchObject([
      {
        physicalJarId: 'jar-1',
        recipeId: 'a',
        servings: 1,
      },
    ])
    expectScheduleConsistency(result)
  })

  it('rejects a plan instead of silently losing leftovers when no physical jar can preserve them', () => {
    expect(() =>
      buildPlan(
        demand([
          {
            recipeId: 'a',
            recipeName: 'A',
            assignedServings: 1,
            leftoverServings: 1,
          },
          {
            recipeId: 'b',
            recipeName: 'B',
            assignedServings: 1,
            leftoverServings: 1,
          },
        ]),
        'retain-and-wash',
        1,
        { cleanCups: 2, usedCups: 0 },
      ),
    ).toThrow(
      'Not enough terminal sales-jar capacity to preserve 1 leftover serving(s) without switching away from retained juice',
    )
  })

  it.each<UsedCupTripPolicy>([
    'retain-and-wash',
    'allow-drop-if-full',
  ])(
    'returns an empty plan for zero demand under %s',
    (policy) => {
      const result = buildPlan(
        demand([]),
        policy,
        2,
      )

      expect(result).toEqual({
        policy,
        carriedJuiceJarCount: 2,
        carriedJuiceJars: [
          {
            physicalJarId: 'jar-1',
            initialRecipeId: null,
            initialServings: 0,
          },
          {
            physicalJarId: 'jar-2',
            initialRecipeId: null,
            initialServings: 0,
          },
        ],
        physicalJarsUsed: 0,
        totalJarLoads: 0,
        distinctFinalJuiceTypes: 0,
        jarTypeSwitches: 0,
        trips: [],
        tripCount: 0,
        totalAssignedServings: 0,
        totalLeftoverServings: 0,
        leftoverJarContents: [],
        maxJuiceJarSlotsCarried: 0,
        cleanCupUnitsRequiredWithoutMiddayWashing: 0,
        reusableCleanCupPoolSize:
          policy === 'retain-and-wash' ? 0 : null,
        initialCleanCups: 0,
        initialUsedCups: 0,
        initialPhysicalCupCount: 0,
        finalCleanCups: 0,
        finalUsedCups: 0,
        finalPhysicalCupCount: 0,
        droppedUsedCups: 0,
        initialWashWaterUnits: 0,
        betweenTripWashWaterUnits: 0,
        totalCupWashWaterUnits: 0,
        returnsHomeBetweenTrips: false,
      })
      expectScheduleConsistency(result)
    },
  )
})
