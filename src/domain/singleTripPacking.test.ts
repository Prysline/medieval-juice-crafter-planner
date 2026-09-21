import { describe, expect, it } from 'vitest'
import type { PreparationDemand } from './preparationDemand'
import { buildSingleTripPacking } from './singleTripPacking'

function demand(
  recipes: PreparationDemand['recipes'],
  cleanCupUses: number,
): PreparationDemand {
  const assignedServings = recipes.reduce(
    (sum, recipe) => sum + recipe.assignedServings,
    0,
  )
  const producedServings = recipes.reduce(
    (sum, recipe) => sum + recipe.producedServings,
    0,
  )

  return {
    ingredients: [],
    productionWaterUnits: recipes.reduce(
      (sum, recipe) => sum + recipe.productionUnits,
      0,
    ),
    cleanCupUses,
    producedServings,
    assignedServings,
    leftoverServings: producedServings - assignedServings,
    recipes,
  }
}

describe('single-trip packing', () => {
  it('packs assigned servings into recipe-specific jars and cups into stacks', () => {
    const result = buildSingleTripPacking(
      demand(
        [
          {
            recipeId: 'lemon',
            recipeName: '檸檬汁',
            customerIds: Array.from({ length: 12 }, (_, index) => `lemon-${index + 1}`),
            productionUnits: 6,
            producedServings: 12,
            assignedServings: 12,
            leftoverServings: 0,
            ingredientUnitsPerJuiceUnit: [],
          },
          {
            recipeId: 'orange',
            recipeName: '橙汁',
            customerIds: ['orange-1', 'orange-2', 'orange-3'],
            productionUnits: 2,
            producedServings: 4,
            assignedServings: 3,
            leftoverServings: 1,
            ingredientUnitsPerJuiceUnit: [],
          },
        ],
        15,
      ),
    )

    expect(result).toEqual({
      capacitySlots: 10,
      requiredSlots: 5,
      overflowSlots: 0,
      fitsInOneTrip: true,
      requiredLoads: [
        {
          kind: 'juice-jar',
          recipeId: 'lemon',
          recipeName: '檸檬汁',
          servings: 10,
          slotCost: 1,
        },
        {
          kind: 'juice-jar',
          recipeId: 'lemon',
          recipeName: '檸檬汁',
          servings: 2,
          slotCost: 1,
        },
        {
          kind: 'juice-jar',
          recipeId: 'orange',
          recipeName: '橙汁',
          servings: 3,
          slotCost: 1,
        },
        {
          kind: 'clean-cups',
          quantity: 10,
          slotCost: 1,
        },
        {
          kind: 'clean-cups',
          quantity: 5,
          slotCost: 1,
        },
      ],
    })
  })

  it('does not carry optimizer leftovers on the customer sales trip', () => {
    const result = buildSingleTripPacking(
      demand(
        [
          {
            recipeId: 'orange',
            recipeName: '橙汁',
            customerIds: ['orange-1'],
            productionUnits: 1,
            producedServings: 2,
            assignedServings: 1,
            leftoverServings: 1,
            ingredientUnitsPerJuiceUnit: [],
          },
        ],
        1,
      ),
    )

    expect(result.requiredLoads).toEqual([
      {
        kind: 'juice-jar',
        recipeId: 'orange',
        recipeName: '橙汁',
        servings: 1,
        slotCost: 1,
      },
      {
        kind: 'clean-cups',
        quantity: 1,
        slotCost: 1,
      },
    ])
  })

  it('reports overflow without inventing which demand to drop', () => {
    const result = buildSingleTripPacking(
      demand(
        [
          {
            recipeId: 'large',
            recipeName: '大量果汁',
            customerIds: Array.from({ length: 101 }, (_, index) => `large-${index + 1}`),
            productionUnits: 51,
            producedServings: 102,
            assignedServings: 101,
            leftoverServings: 1,
            ingredientUnitsPerJuiceUnit: [],
          },
        ],
        101,
      ),
    )

    expect(result.requiredLoads).toHaveLength(22)
    expect(result.requiredSlots).toBe(22)
    expect(result.capacitySlots).toBe(10)
    expect(result.overflowSlots).toBe(12)
    expect(result.fitsInOneTrip).toBe(false)
  })

  it('keeps every jar at or below ten servings and one recipe identity', () => {
    const result = buildSingleTripPacking(
      demand(
        [
          {
            recipeId: 'lemon',
            recipeName: '檸檬汁',
            customerIds: Array.from({ length: 15 }, (_, index) => `lemon-${index + 1}`),
            productionUnits: 8,
            producedServings: 16,
            assignedServings: 15,
            leftoverServings: 1,
            ingredientUnitsPerJuiceUnit: [],
          },
        ],
        15,
      ),
    )

    const jars = result.requiredLoads.filter(
      (load) => load.kind === 'juice-jar',
    )
    expect(jars.map((jar) => jar.servings)).toEqual([10, 5])
    expect(
      jars.every(
        (jar) =>
          jar.recipeId === 'lemon' &&
          jar.servings > 0 &&
          jar.servings <= 10,
      ),
    ).toBe(true)
  })

  it('returns an empty feasible load for no assigned customers', () => {
    const result = buildSingleTripPacking(demand([], 0))

    expect(result).toEqual({
      capacitySlots: 10,
      requiredSlots: 0,
      overflowSlots: 0,
      fitsInOneTrip: true,
      requiredLoads: [],
    })
  })
})
