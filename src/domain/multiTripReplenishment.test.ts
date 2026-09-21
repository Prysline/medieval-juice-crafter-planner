import { describe, expect, it } from 'vitest'
import type { PreparationDemand } from './preparationDemand'
import {
  buildMultiTripReplenishmentPlan,
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
      productionUnits: Math.ceil(recipe.assignedServings / 2),
      producedServings: recipe.assignedServings,
      leftoverServings: 0,
      ingredientUnitsPerJuiceUnit: [],
    })),
  }
}

function sixFullJarRecipes(): PreparationDemand {
  return demand(
    Array.from({ length: 6 }, (_, index) => ({
      recipeId: `recipe-${index + 1}`,
      recipeName: `配方 ${index + 1}`,
      assignedServings: 10,
    })),
  )
}

describe('multi-trip replenishment', () => {
  it('keeps one trip when jars and cup stacks fit the selected policy', () => {
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
      jarRackSlotsRequired: 3,
    })
    expect(result.reusableCleanCupPoolSize).toBe(18)
    expect(result.betweenTripWashWaterUnits).toBe(0)
  })

  it('uses the five-slot jar rack as a per-trip staging limit', () => {
    const result = buildMultiTripReplenishmentPlan(
      sixFullJarRecipes(),
      'allow-drop-if-full',
    )

    expect(result.tripCount).toBe(2)
    expect(result.trips[0].juiceJars).toHaveLength(5)
    expect(result.trips[0]).toMatchObject({
      totalServings: 50,
      cleanCupStacks: 5,
      departureSlots: 10,
      effectiveDepartureSlotLimit: 10,
      usedCupDropMayOccur: true,
      jarRackSlotsRequired: 5,
    })
    expect(result.trips[1].juiceJars).toHaveLength(1)
    expect(result.maxJarRackSlotsUsed).toBe(5)
  })

  it('reserves one transient used-cup slot under retain-and-wash', () => {
    const result = buildMultiTripReplenishmentPlan(
      sixFullJarRecipes(),
      'retain-and-wash',
    )

    expect(result.tripCount).toBe(2)
    expect(result.trips[0]).toMatchObject({
      totalServings: 40,
      departureSlots: 8,
      effectiveDepartureSlotLimit: 9,
      reservedTransientUsedCupSlot: 1,
      usedCupDropMayOccur: false,
    })
    expect(result.trips[1]).toMatchObject({
      totalServings: 20,
      departureSlots: 4,
      effectiveDepartureSlotLimit: 9,
      reservedTransientUsedCupSlot: 1,
      usedCupDropMayOccur: false,
    })
    expect(result.reusableCleanCupPoolSize).toBe(40)
    expect(result.betweenTripWashWaterUnits).toBe(40)
    expect(result.returnsHomeBetweenTrips).toBe(true)
  })

  it('does not assume cup reuse when full-backpack dropping is allowed', () => {
    const result = buildMultiTripReplenishmentPlan(
      sixFullJarRecipes(),
      'allow-drop-if-full',
    )

    expect(result.cleanCupUnitsRequiredWithoutMiddayWashing).toBe(60)
    expect(result.reusableCleanCupPoolSize).toBeNull()
    expect(result.betweenTripWashWaterUnits).toBe(0)
    expect(result.trips[0].usedCupDropMayOccur).toBe(true)
  })

  it.each<UsedCupTripPolicy>([
    'retain-and-wash',
    'allow-drop-if-full',
  ])('returns an empty plan for zero demand under %s', (policy) => {
    const result = buildMultiTripReplenishmentPlan(
      demand([]),
      policy,
    )

    expect(result).toEqual({
      policy,
      trips: [],
      tripCount: 0,
      totalAssignedServings: 0,
      totalJuiceJars: 0,
      maxJarRackSlotsUsed: 0,
      cleanCupUnitsRequiredWithoutMiddayWashing: 0,
      reusableCleanCupPoolSize:
        policy === 'retain-and-wash' ? 0 : null,
      betweenTripWashWaterUnits: 0,
      returnsHomeBetweenTrips: false,
    })
  })
})
