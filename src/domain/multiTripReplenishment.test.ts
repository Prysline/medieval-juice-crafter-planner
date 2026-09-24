import { describe, expect, it } from 'vitest'
import type { InventoryState, JuiceJarInventoryItem } from '../types'
import type { PreparationDemand } from './preparationDemand'
import { minimumJarTypeSwitchesForInitialJars } from './jarSwitches'
import { buildPreparationShortfall } from './preparationShortfall'
import {
  buildMultiTripReplenishmentPlan as buildMultiTripReplenishmentPlanWithCups,
  buildProductionJarFillsFromSchedule,
  countJarTypeSwitchesFromSchedule,
  type MultiTripReplenishmentPlan,
  type MultiTripSalesTrip,
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
  allowDiscardRetainedJuice = false,
): MultiTripReplenishmentPlan {
  return buildMultiTripReplenishmentPlanWithCups(
    salesDemand,
    policy,
    jars,
    cups,
    shortfallFor(salesDemand, jars),
    undefined,
    allowDiscardRetainedJuice,
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
          load.servings + load.retainedLeftoverServings <= 10 &&
          load.plannedFillServings <= 10,
      ),
    ),
  ).toBe(true)
  expect(
    result.productionJarFills.every(
      (fill) =>
        fill.servings >= 2 &&
        fill.servings <= 10 &&
        fill.servings % 2 === 0,
    ),
  ).toBe(true)
  expect(
    result.productionJarFills.reduce(
      (sum, fill) => sum + fill.servings,
      0,
    ),
  ).toBe(
    result.trips.reduce(
      (sum, trip) =>
        sum +
        trip.juiceJars.reduce(
          (tripSum, load) =>
            tripSum + load.plannedFillServings,
          0,
        ),
      0,
    ),
  )

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

  it('preserves a matching initial recipe before scheduling unrelated switch loads', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        assignedServings: 3,
      },
      {
        recipeId: 'c',
        recipeName: 'C',
        assignedServings: 4,
      },
      {
        recipeId: 'd',
        recipeName: 'D',
        assignedServings: 2,
      },
    ])
    const jars: JuiceJarInventoryItem[] = [
      {
        id: 'jar-a',
        recipeId: 'a',
        servings: 1,
      },
      {
        id: 'jar-b-retained',
        recipeId: 'b',
        servings: 1,
      },
    ]

    const result = buildPlanWithJars(
      salesDemand,
      'retain-and-wash',
      jars,
      { cleanCups: 9, usedCups: 0 },
    )

    expect(
      minimumJarTypeSwitchesForInitialJars(
        jars.map((jar) => ({
          recipeId: jar.recipeId,
          servings: jar.servings,
        })),
        salesDemand.recipes.map((recipe) => recipe.recipeId),
      ),
    ).toBe(2)
    expect(result.jarTypeSwitches).toBe(2)
    expect(
      result.trips.flatMap((trip) =>
        trip.juiceJars
          .filter((load) => load.physicalJarId === 'jar-a')
          .map((load) => ({
            recipeId: load.recipeId,
            fillAction: load.fillAction,
          })),
      ),
    ).toEqual([
      { recipeId: 'a', fillAction: 'use-existing' },
      { recipeId: 'a', fillAction: 'refill-same-type' },
      { recipeId: 'c', fillAction: 'type-switch' },
      { recipeId: 'd', fillAction: 'type-switch' },
    ])
    expectScheduleConsistency(result)
  })

  it('reserves a matching initial jar for a terminal leftover recipe', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        assignedServings: 2,
      },
      {
        recipeId: 'c',
        recipeName: 'C',
        assignedServings: 2,
      },
      {
        recipeId: 'd',
        recipeName: 'D',
        assignedServings: 2,
      },
    ])
    const jars: JuiceJarInventoryItem[] = [
      {
        id: 'jar-a',
        recipeId: 'a',
        servings: 1,
      },
      {
        id: 'jar-empty',
        recipeId: null,
        servings: 0,
      },
    ]

    const result = buildPlanWithJars(
      salesDemand,
      'retain-and-wash',
      jars,
      { cleanCups: 6, usedCups: 0 },
    )

    expect(
      minimumJarTypeSwitchesForInitialJars(
        jars.map((jar) => ({
          recipeId: jar.recipeId,
          servings: jar.servings,
        })),
        salesDemand.recipes.map((recipe) => recipe.recipeId),
      ),
    ).toBe(1)
    expect(result.jarTypeSwitches).toBe(1)
    expect(
      result.leftoverJarContents.some(
        (leftover) =>
          leftover.physicalJarId === 'jar-a' &&
          leftover.recipeId === 'a',
      ),
    ).toBe(true)
    expect(
      result.trips.flatMap((trip) =>
        trip.juiceJars
          .filter((load) => load.physicalJarId === 'jar-a')
          .map((load) => ({
            recipeId: load.recipeId,
            fillAction: load.fillAction,
          })),
      ),
    ).toEqual([
      { recipeId: 'a', fillAction: 'use-existing' },
      { recipeId: 'a', fillAction: 'refill-same-type' },
    ])
    expectScheduleConsistency(result)
  })

  it('uses terminal-aware physical minimum when prefilled terminal recipes must be revisited', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        assignedServings: 2,
      },
      {
        recipeId: 'b',
        recipeName: 'B',
        assignedServings: 2,
      },
      {
        recipeId: 'c',
        recipeName: 'C',
        assignedServings: 2,
      },
    ])
    const jars: JuiceJarInventoryItem[] = [
      {
        id: 'jar-a',
        recipeId: 'a',
        servings: 1,
      },
      {
        id: 'jar-b',
        recipeId: 'b',
        servings: 1,
      },
    ]

    expect(
      minimumJarTypeSwitchesForInitialJars(
        jars,
        salesDemand.recipes.map((recipe) => recipe.recipeId),
      ),
    ).toBe(1)

    const result = buildPlanWithJars(
      salesDemand,
      'retain-and-wash',
      jars,
      { cleanCups: 6, usedCups: 0 },
    )

    expect(result.jarTypeSwitches).toBe(2)
    expect(
      result.trips.flatMap((trip) =>
        trip.juiceJars
          .filter((load) => load.physicalJarId === 'jar-a')
          .map((load) => ({
            recipeId: load.recipeId,
            fillAction: load.fillAction,
          })),
      ),
    ).toEqual([
      { recipeId: 'a', fillAction: 'use-existing' },
      { recipeId: 'c', fillAction: 'type-switch' },
      { recipeId: 'a', fillAction: 'type-switch' },
    ])
    expect(
      result.leftoverJarContents.map((item) => item.recipeId).sort(),
    ).toEqual(['a', 'b'])
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
    expect(result.productionJarFills).toEqual([
      expect.objectContaining({
        physicalJarId: 'owned-a',
        recipeId: 'b',
        beforeTripNumber: 2,
        servings: 2,
        fillAction: 'type-switch',
      }),
    ])
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

  it('discards retained juice only when explicitly enabled and only from the minimum required jar', () => {
    const salesDemand = namedRecipes(['C'], 1)
    const result = buildPlanWithJars(
      salesDemand,
      'retain-and-wash',
      [
        { id: 'keep-five', recipeId: 'a', servings: 5 },
        { id: 'discard-one', recipeId: 'b', servings: 1 },
      ],
      { cleanCups: 1, usedCups: 0 },
      true,
    )

    expect(result.allowDiscardRetainedJuice).toBe(true)
    expect(result.discardedInitialJuice).toEqual([
      {
        physicalJarId: 'discard-one',
        recipeId: 'b',
        servings: 1,
      },
    ])
    expect(
      new Set(
        result.trips.flatMap((trip) =>
          trip.juiceJars.map((load) => load.physicalJarId),
        ),
      ),
    ).toEqual(new Set(['discard-one']))
    expect(result.jarTypeSwitches).toBe(1)
    expectScheduleConsistency(result)
  })

  it('can serve useful initial juice first, then discard only the retained remainder before a type switch', () => {
    const salesDemand = namedRecipes(['A', 'B'], 1)
    const result = buildPlanWithJars(
      salesDemand,
      'retain-and-wash',
      [{ id: 'shared', recipeId: 'a', servings: 2 }],
      { cleanCups: 2, usedCups: 0 },
      true,
    )

    expect(result.discardedInitialJuice).toEqual([
      {
        physicalJarId: 'shared',
        recipeId: 'a',
        servings: 1,
      },
    ])
    expect(
      result.trips.flatMap((trip) =>
        trip.juiceJars.map((load) => ({
          recipeId: load.recipeId,
          servings: load.servings,
          retainedLeftoverServings: load.retainedLeftoverServings,
          fillAction: load.fillAction,
        })),
      ),
    ).toEqual([
      {
        recipeId: 'a',
        servings: 1,
        retainedLeftoverServings: 0,
        fillAction: 'use-existing',
      },
      {
        recipeId: 'b',
        servings: 1,
        retainedLeftoverServings: 1,
        fillAction: 'type-switch',
      },
    ])
    expect(result.leftoverJarContents).toEqual([
      expect.objectContaining({
        physicalJarId: 'shared',
        recipeId: 'b',
        servings: 1,
      }),
    ])
    expectScheduleConsistency(result)
  })

  it('rejects unplaceable new-production leftovers when discard opt-in is off', () => {
    const salesDemand = namedRecipes(['A', 'B'], 1)

    expect(() =>
      buildPlanWithJars(
        salesDemand,
        'retain-and-wash',
        [{ id: 'only', recipeId: null, servings: 0 }],
        { cleanCups: 2, usedCups: 0 },
        false,
      ),
    ).toThrow(/Terminal leftovers require 2 reusable jars/)
  })

  it('discards only the minimum unplaceable new-production leftover when explicitly enabled', () => {
    const salesDemand = namedRecipes(['A', 'B'], 1)
    const result = buildPlanWithJars(
      salesDemand,
      'retain-and-wash',
      [{ id: 'only', recipeId: null, servings: 0 }],
      { cleanCups: 2, usedCups: 0 },
      true,
    )

    expect(result.totalAssignedServings).toBe(2)
    expect(result.discardedInitialJuice).toEqual([])
    expect(result.discardedNewProductionJuice).toEqual([
      {
        physicalJarId: 'only',
        recipeId: 'b',
        recipeName: 'B',
        servings: 1,
        afterTripNumber: 1,
      },
    ])
    expect(result.totalLeftoverServings).toBe(1)
    expect(result.leftoverJarContents).toEqual([
      expect.objectContaining({
        physicalJarId: 'only',
        recipeId: 'a',
        servings: 1,
      }),
    ])
    expect(
      result.productionJarFills.map((fill) => fill.servings),
    ).toEqual([2, 2])
    expectScheduleConsistency(result)
  })

  it('discards one of three new leftovers when only two terminal jars exist', () => {
    const salesDemand = namedRecipes(['A', 'B', 'C'], 1)
    const result = buildPlanWithJars(
      salesDemand,
      'retain-and-wash',
      carriedJars(2),
      { cleanCups: 3, usedCups: 0 },
      true,
    )

    expect(result.discardedNewProductionJuice).toHaveLength(1)
    expect(
      result.discardedNewProductionJuice.reduce(
        (sum, item) => sum + item.servings,
        0,
      ),
    ).toBe(1)
    expect(result.totalLeftoverServings).toBe(2)
    expectScheduleConsistency(result)
  })

  it('can discard retained initial juice and a new-production leftover in the same plan', () => {
    const salesDemand = namedRecipes(['A', 'B', 'C'], 1)
    const result = buildPlanWithJars(
      salesDemand,
      'retain-and-wash',
      [{ id: 'shared', recipeId: 'a', servings: 2 }],
      { cleanCups: 3, usedCups: 0 },
      true,
    )

    expect(result.discardedInitialJuice).toEqual([
      {
        physicalJarId: 'shared',
        recipeId: 'a',
        servings: 1,
      },
    ])
    expect(result.discardedNewProductionJuice).toHaveLength(1)
    expect(result.discardedNewProductionJuice[0].servings).toBe(1)
    expect(result.totalAssignedServings).toBe(3)
    expectScheduleConsistency(result)
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
      'a-customer-2',
      'b-customer-1',
      'b-customer-2',
      'c-customer-1',
      'c-customer-2',
      'd-customer-1',
      'd-customer-2',
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

  it('does not duplicate a type switch merely to parallelize same-recipe chunks', () => {
    const salesDemand = demand([
      {
        recipeId: 'a',
        recipeName: 'A',
        assignedServings: 1,
      },
      {
        recipeId: 'b',
        recipeName: 'B',
        assignedServings: 1,
      },
      {
        recipeId: 'c',
        recipeName: 'C',
        assignedServings: 11,
        leftoverServings: 1,
      },
    ])
    const jars: JuiceJarInventoryItem[] = [
      { id: 'jar-a', recipeId: 'a', servings: 1 },
      { id: 'jar-b', recipeId: 'b', servings: 1 },
    ]

    const result = buildPlanWithJars(
      salesDemand,
      'retain-and-wash',
      jars,
      { cleanCups: 13, usedCups: 0 },
    )

    expect(result.jarTypeSwitches).toBe(1)
    expect(result.jarTypeSwitches).toBe(
      minimumJarTypeSwitchesForInitialJars(
        jars,
        ['a', 'b', 'c'],
      ),
    )
    expect(
      result.trips
        .flatMap((trip) => trip.juiceJars)
        .filter((load) => load.recipeId === 'c')
        .map((load) => load.physicalJarId),
    ).toEqual(['jar-a', 'jar-a'])
    expectScheduleConsistency(result)
  })

  it('keeps a bounded small-state matrix free of terminal-aware schedule drift', () => {
    const initialStates: Array<JuiceJarInventoryItem['recipeId']> = [
      null,
      'a',
      'b',
    ]
    const demandCases = [
      [
        { recipeId: 'a', recipeName: 'A', assignedServings: 1 },
        { recipeId: 'c', recipeName: 'C', assignedServings: 1, leftoverServings: 1 },
      ],
      [
        { recipeId: 'a', recipeName: 'A', assignedServings: 1 },
        { recipeId: 'b', recipeName: 'B', assignedServings: 1 },
        { recipeId: 'c', recipeName: 'C', assignedServings: 11, leftoverServings: 1 },
      ],
      [
        { recipeId: 'a', recipeName: 'A', assignedServings: 1 },
        { recipeId: 'b', recipeName: 'B', assignedServings: 1 },
        { recipeId: 'c', recipeName: 'C', assignedServings: 1, leftoverServings: 1 },
        { recipeId: 'd', recipeName: 'D', assignedServings: 1, leftoverServings: 1 },
      ],
    ]

    for (const first of initialStates) {
      for (const second of initialStates) {
        const jars: JuiceJarInventoryItem[] = [
          {
            id: 'jar-1',
            recipeId: first,
            servings: first ? 1 : 0,
          },
          {
            id: 'jar-2',
            recipeId: second,
            servings: second ? 1 : 0,
          },
        ]

        for (const demandCase of demandCases) {
          const salesDemand = demand(demandCase)
          const assigned = salesDemand.assignedServings

          try {
            const result = buildPlanWithJars(
              salesDemand,
              'retain-and-wash',
              jars,
              { cleanCups: assigned, usedCups: 0 },
            )

            expect(result.jarTypeSwitches).toBeGreaterThanOrEqual(0)
            expectScheduleConsistency(result)
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes(
                'terminal-aware physical minimum',
              )
            ) {
              throw error
            }
          }
        }
      }
    }
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
      totalServings: 40,
      departureSlots: 9,
      effectiveDepartureSlotLimit: 10,
      reservedTransientUsedCupSlot: 0,
      usedCupDropMayOccur: false,
      droppedUsedCups: 0,
      peakOccupiedSlots: 10,
      juiceJarSlotsCarried: 5,
    })
    expect(retained.reusableCleanCupPoolSize).toBe(40)
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

  it('never splits one prepared physical jar load across cup-limited trips', () => {
    expect(() =>
      buildPlan(
        namedRecipes(['A'], 10),
        'retain-and-wash',
        1,
        { cleanCups: 5, usedCups: 0 },
      ),
    ).toThrow(/No remaining sales load can fit/)
  })

  it('keeps each physical jar load wholly inside one trip when other complete loads can be scheduled later', () => {
    const result = buildPlan(
      namedRecipes(['A'], 15),
      'retain-and-wash',
      2,
      { cleanCups: 10, usedCups: 0 },
    )

    const tripNumbersByJar = new Map<string, Set<number>>()
    for (const trip of result.trips) {
      for (const load of trip.juiceJars) {
        const trips = tripNumbersByJar.get(load.physicalJarId) ?? new Set<number>()
        trips.add(trip.tripNumber)
        tripNumbersByJar.set(load.physicalJarId, trips)
      }
    }
    expect(
      [...tripNumbersByJar.values()].every((trips) => trips.size === 1),
    ).toBe(true)
    expectScheduleConsistency(result)
  })

  it('washes and reuses a smaller physical cup pool across complete jar loads', () => {
    const result = buildPlan(
      namedRecipes(['A'], 15),
      'retain-and-wash',
      2,
      { cleanCups: 10, usedCups: 0 },
    )

    expect(result.tripCount).toBe(2)
    expect(result.trips.map((trip) => trip.totalServings)).toEqual([
      10,
      5,
    ])
    expect(result.trips.map((trip) => trip.cupsWashedBeforeTrip)).toEqual([
      0,
      5,
    ])
    expect(result.initialPhysicalCupCount).toBe(10)
    expect(result.finalPhysicalCupCount).toBe(10)
    expect(result.betweenTripWashWaterUnits).toBe(5)
    expect(result.totalCupWashWaterUnits).toBe(5)
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
      'Sales planning requires at least one physical juice jar',
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
      'Terminal leftovers require 2 reusable jars, but only 1 are available',
    )
  })

  it('reacts to terminal jar count: four jars fail for five leftover recipes, while five jars succeed', () => {
    const salesDemand = demand(
      ['A', 'B', 'C', 'D', 'E'].map((name) => ({
        recipeId: name.toLowerCase(),
        recipeName: name,
        assignedServings: 1,
        leftoverServings: 1,
      })),
    )

    expect(() =>
      buildPlan(
        salesDemand,
        'retain-and-wash',
        4,
        { cleanCups: 5, usedCups: 0 },
      ),
    ).toThrow(
      'Terminal leftovers require 5 reusable jars, but only 4 are available',
    )

    const result = buildPlan(
      salesDemand,
      'retain-and-wash',
      5,
      { cleanCups: 5, usedCups: 0 },
    )

    expect(result.totalLeftoverServings).toBe(5)
    expect(result.leftoverJarContents).toHaveLength(5)
    expect(
      new Set(
        result.leftoverJarContents.map(
          (item) => item.physicalJarId,
        ),
      ).size,
    ).toBe(5)
    expectScheduleConsistency(result)
  })

  it('swaps rack-stored physical jars between trips so separate leftovers remain feasible', () => {
    const salesDemand = demand([
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
    ])
    const jars = carriedJars(2)
    const result = buildMultiTripReplenishmentPlanWithCups(
      salesDemand,
      'retain-and-wash',
      jars,
      { cleanCups: 2, usedCups: 0 },
      shortfallFor(salesDemand, jars),
      {
        mode: 'fixed-slots',
        reservedSlots: 1,
        minimumCarriedSlots: 1,
      },
    )

    expect(result.tripCount).toBe(2)
    expect(result.jarTypeSwitches).toBe(0)
    expect(result.totalLeftoverServings).toBe(2)
    expect(result.leftoverJarContents).toHaveLength(2)
    expect(result.trips.map((trip) => trip.carriedPhysicalJarIds)).toEqual([
      ['jar-1'],
      ['jar-2'],
    ])
    expect(
      result.trips.every((trip) => trip.juiceJarSlotsCarried === 1),
    ).toBe(true)
    expectScheduleConsistency(result)
  })

  it('keeps every owned physical jar on the player when no rack space exists', () => {
    const salesDemand = namedRecipes(['A'], 1)
    const jars = carriedJars(2)
    const result = buildMultiTripReplenishmentPlanWithCups(
      salesDemand,
      'allow-drop-if-full',
      jars,
      { cleanCups: 1, usedCups: 0 },
      shortfallFor(salesDemand, jars),
      {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 2,
      },
    )

    expect(result.trips[0].carriedPhysicalJarIds).toEqual([
      'jar-1',
      'jar-2',
    ])
    expect(result.trips[0].juiceJarSlotsCarried).toBe(2)
    expect(result.minimumCarriedJuiceJarSlots).toBe(2)
  })

  it('allows the finalizer to top up a non-empty jar with the same recipe', () => {
    const trip: MultiTripSalesTrip = {
      tripNumber: 1,
      juiceJars: [
        {
          physicalJarId: 'jar-1',
          recipeId: 'a',
          recipeName: 'A',
          customerIds: ['customer-1', 'customer-2'],
          servings: 2,
          retainedLeftoverServings: 5,
          plannedFillServings: 4,
          slotCost: 1,
          fillAction: 'refill-same-type',
          previousRecipeId: 'a',
          previousRecipeName: 'A',
        },
      ],
      carriedPhysicalJarIds: ['jar-1'],
      totalServings: 2,
      cleanCupStacks: 1,
      cleanCupsCarried: 2,
      departureSlots: 2,
      effectiveDepartureSlotLimit: 10,
      spareDepartureSlots: 8,
      reservedTransientUsedCupSlot: 0,
      usedCupDropMayOccur: false,
      droppedUsedCups: 0,
      cupsWashedBeforeTrip: 0,
      cupWashWaterUnits: 0,
      cleanCupsBeforeTrip: 2,
      usedCupsBeforeTrip: 0,
      cleanCupsAfterTrip: 0,
      usedCupsAfterTrip: 2,
      physicalCupsAfterTrip: 2,
      peakCupSlots: 1,
      peakOccupiedSlots: 2,
      juiceJarSlotsCarried: 1,
    }

    expect(
      buildProductionJarFillsFromSchedule(
        [trip],
        [
          {
            physicalJarId: 'jar-1',
            initialRecipeId: 'a',
            initialServings: 3,
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        physicalJarId: 'jar-1',
        recipeId: 'a',
        servings: 4,
        servingsAfterFill: 7,
        fillAction: 'refill-same-type',
        receiver: 'carried-jar',
      }),
    ])
  })

  it('rejects same-recipe top-up when the physical jar would exceed ten servings', () => {
    const trip: MultiTripSalesTrip = {
      tripNumber: 1,
      juiceJars: [
        {
          physicalJarId: 'jar-1',
          recipeId: 'a',
          recipeName: 'A',
          customerIds: ['customer-1'],
          servings: 1,
          retainedLeftoverServings: 0,
          plannedFillServings: 4,
          slotCost: 1,
          fillAction: 'refill-same-type',
          previousRecipeId: 'a',
          previousRecipeName: 'A',
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
    }

    expect(() =>
      buildProductionJarFillsFromSchedule(
        [trip],
        [
          {
            physicalJarId: 'jar-1',
            initialRecipeId: 'a',
            initialServings: 7,
          },
        ],
      ),
    ).toThrow('exceeds juice capacity')
  })

  it('rejects filling a different recipe into a non-empty physical jar', () => {
    const trip: MultiTripSalesTrip = {
      tripNumber: 1,
      juiceJars: [
        {
          physicalJarId: 'jar-1',
          recipeId: 'b',
          recipeName: 'B',
          customerIds: ['customer-1'],
          servings: 1,
          retainedLeftoverServings: 0,
          plannedFillServings: 2,
          slotCost: 1,
          fillAction: 'type-switch',
          previousRecipeId: 'a',
          previousRecipeName: 'A',
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
    }

    expect(() =>
      buildProductionJarFillsFromSchedule(
        [trip],
        [
          {
            physicalJarId: 'jar-1',
            initialRecipeId: 'a',
            initialServings: 3,
          },
        ],
      ),
    ).toThrow('still contains a different recipe')
  })

  it('keeps rack-stored physical jars beyond the ten-slot backpack limit available to the day plan', () => {
    const salesDemand = demand([])
    const jars = carriedJars(12)
    const result = buildMultiTripReplenishmentPlanWithCups(
      salesDemand,
      'retain-and-wash',
      jars,
      { cleanCups: 0, usedCups: 0 },
      shortfallFor(salesDemand, jars),
      {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 2,
      },
    )

    expect(result.carriedJuiceJarCount).toBe(12)
    expect(result.carriedJuiceJars).toHaveLength(12)
    expect(result.trips).toEqual([])
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
        jarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: 2,
        minimumCarriedJuiceJarSlots: 2,
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
        productionJarFills: [],
        allowDiscardRetainedJuice: false,
        discardedInitialJuice: [],
        discardedNewProductionJuice: [],
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
