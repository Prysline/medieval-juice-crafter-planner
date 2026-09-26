import { describe, expect, it } from 'vitest'
import { buildRemainingSalesTripPlan } from './remainingSalesTripPlanner'

const routing = {
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
    'fountain-a': 'tranquil-fountain',
    'ibex-a': 'ibex-statue',
  },
} as const

describe('remaining sales trip planner', () => {
  it('removes supplied customers without changing the original recipe assignment', () => {
    const plan = buildRemainingSalesTripPlan({
      recipeAssignments: [
        {
          recipeId: 'recipe-a',
          recipeName: 'A',
          customerIds: ['east-a', 'fountain-a'],
        },
        {
          recipeId: 'recipe-b',
          recipeName: 'B',
          customerIds: ['east-b', 'ibex-a'],
        },
      ],
      suppliedCustomerIds: ['east-a', 'ibex-a'],
      originalTripServingCounts: [3, 1],
      ...routing,
    })

    expect(plan).toMatchObject({
      totalCustomerCount: 4,
      suppliedCustomerCount: 2,
      remainingCustomerCount: 2,
      maxCustomerServicesPerTrip: 3,
    })
    expect(plan.recipes).toEqual([
      {
        recipeId: 'recipe-a',
        recipeName: 'A',
        servings: 1,
        customerIds: ['fountain-a'],
      },
      {
        recipeId: 'recipe-b',
        recipeName: 'B',
        servings: 1,
        customerIds: ['east-b'],
      },
    ])
    expect(plan.regionPlan.customerAssignments).toEqual(
      expect.arrayContaining([
        {
          customerId: 'fountain-a',
          recipeId: 'recipe-a',
          regionId: 'tranquil-fountain',
        },
        {
          customerId: 'east-b',
          recipeId: 'recipe-b',
          regionId: 'east-harbor',
        },
      ]),
    )
  })

  it('uses the largest original trip size as the abstract remaining-trip capacity', () => {
    const plan = buildRemainingSalesTripPlan({
      recipeAssignments: [
        {
          recipeId: 'recipe-a',
          recipeName: 'A',
          customerIds: ['east-a', 'fountain-a'],
        },
        {
          recipeId: 'recipe-b',
          recipeName: 'B',
          customerIds: ['east-b', 'ibex-a'],
        },
      ],
      suppliedCustomerIds: ['east-a'],
      originalTripServingCounts: [2, 3],
      ...routing,
    })

    expect(plan.maxCustomerServicesPerTrip).toBe(3)
    expect(plan.regionPlan.tripCount).toBe(1)
    expect(
      plan.regionPlan.trips[0]?.services.flatMap(
        (service) => service.customerAssignments,
      ),
    ).toHaveLength(3)
  })

  it('returns an empty Region plan when every assigned customer is already supplied', () => {
    const plan = buildRemainingSalesTripPlan({
      recipeAssignments: [
        {
          recipeId: 'recipe-a',
          recipeName: 'A',
          customerIds: ['east-a'],
        },
      ],
      suppliedCustomerIds: ['east-a'],
      originalTripServingCounts: [1],
      ...routing,
    })

    expect(plan.remainingCustomerCount).toBe(0)
    expect(plan.recipes).toEqual([])
    expect(plan.regionPlan.trips).toEqual([])
  })
})
