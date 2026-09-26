import { describe, expect, it } from 'vitest'
import {
  compareRegionServicePlanScores,
  planRegionServiceTrips,
  type RegionRecipeAssignment,
  type RegionServicePlan,
  type RegionTopologyEdge,
} from './regionServicePlanner'

function assignments(
  ...entries: Array<[recipeId: string, customerIds: string[]]>
): RegionRecipeAssignment[] {
  return entries.map(([recipeId, customerIds]) => ({
    recipeId,
    customerIds,
  }))
}

function assignmentPairs(plan: RegionServicePlan): string[] {
  return plan.customerAssignments
    .map(({ recipeId, customerId }) => `${recipeId}:${customerId}`)
    .sort()
}

function tripServiceSignatures(plan: RegionServicePlan): string[] {
  return plan.trips
    .map((trip) => [...trip.servicedRegionIds].sort().join('+'))
    .sort()
}

describe('region service planner', () => {
  it('concentrates workshop-local and remote service without changing recipe assignment', () => {
    const recipeAssignments = assignments(
      ['local', ['local-1', 'local-2']],
      ['remote', ['remote-1', 'remote-2']],
    )

    const plan = planRegionServiceTrips({
      activeWorkshop: { id: 'workshop', regionId: 'home' },
      topology: {
        edges: [{ from: 'home', to: 'far', cost: 2 }],
      },
      recipeAssignments,
      customerRegionById: {
        'local-1': 'home',
        'local-2': 'home',
        'remote-1': 'far',
        'remote-2': 'far',
      },
      maxCustomerServicesPerTrip: 2,
    })

    expect(plan.routeCost).toBe(4)
    expect(plan.tripCount).toBe(2)
    expect(plan.serviceFragmentation).toBe(0)
    expect(tripServiceSignatures(plan)).toEqual(['far', 'home'])
    expect(assignmentPairs(plan)).toEqual([
      'local:local-1',
      'local:local-2',
      'remote:remote-1',
      'remote:remote-2',
    ])
  })

  it('can flip the preferred trip grouping when only the active workshop changes', () => {
    const topology: { edges: RegionTopologyEdge[] } = {
      edges: [
        { from: 'a', to: 'b', cost: 1 },
        { from: 'b', to: 'c', cost: 1 },
        { from: 'c', to: 'd', cost: 1 },
      ],
    }
    const recipeAssignments = assignments([
      'shared',
      ['customer-b', 'customer-c', 'customer-d'],
    ])
    const customerRegionById = {
      'customer-b': 'b',
      'customer-c': 'c',
      'customer-d': 'd',
    }

    const fromA = planRegionServiceTrips({
      activeWorkshop: { id: 'workshop-a', regionId: 'a' },
      topology,
      recipeAssignments,
      customerRegionById,
      maxCustomerServicesPerTrip: 2,
    })
    const fromD = planRegionServiceTrips({
      activeWorkshop: { id: 'workshop-d', regionId: 'd' },
      topology,
      recipeAssignments,
      customerRegionById,
      maxCustomerServicesPerTrip: 2,
    })

    expect(tripServiceSignatures(fromA)).toEqual(['b', 'c+d'])
    expect(tripServiceSignatures(fromD)).toEqual(['b+c', 'd'])
    expect(fromA.routeCost).toBe(8)
    expect(fromD.routeCost).toBe(4)
    expect(assignmentPairs(fromA)).toEqual(assignmentPairs(fromD))
  })

  it('marks an along-route serviced Region as side service and keeps pure transit separate', () => {
    const topology = {
      edges: [
        { from: 'home', to: 'a', cost: 1 },
        { from: 'a', to: 'b', cost: 1 },
      ],
    }

    const withAlongRouteService = planRegionServiceTrips({
      activeWorkshop: { id: 'workshop', regionId: 'home' },
      topology,
      recipeAssignments: assignments([
        'recipe',
        ['customer-a', 'customer-b'],
      ]),
      customerRegionById: {
        'customer-a': 'a',
        'customer-b': 'b',
      },
      maxCustomerServicesPerTrip: 2,
    })

    expect(withAlongRouteService.tripCount).toBe(1)
    expect(withAlongRouteService.trips[0].primaryRegionIds).toEqual(['b'])
    expect(withAlongRouteService.trips[0].sideRegionIds).toEqual(['a'])
    expect(withAlongRouteService.trips[0].transitRegionIds).toEqual([])

    const transitOnly = planRegionServiceTrips({
      activeWorkshop: { id: 'workshop', regionId: 'home' },
      topology,
      recipeAssignments: assignments(['recipe', ['customer-b']]),
      customerRegionById: {
        'customer-b': 'b',
      },
      maxCustomerServicesPerTrip: 2,
    })

    expect(transitOnly.trips[0].servicedRegionIds).toEqual(['b'])
    expect(transitOnly.trips[0].primaryRegionIds).toEqual(['b'])
    expect(transitOnly.trips[0].sideRegionIds).toEqual([])
    expect(transitOnly.trips[0].transitRegionIds).toEqual(['a'])
  })

  it('charges a shared T-shaped route prefix once per trip footprint', () => {
    const topology = {
      edges: [
        { from: 'home', to: 'a', cost: 1 },
        { from: 'a', to: 'b', cost: 1 },
        { from: 'a', to: 'c', cost: 1 },
      ],
    }

    const combined = planRegionServiceTrips({
      activeWorkshop: { id: 'workshop', regionId: 'home' },
      topology,
      recipeAssignments: assignments([
        'recipe',
        ['customer-b', 'customer-c'],
      ]),
      customerRegionById: {
        'customer-b': 'b',
        'customer-c': 'c',
      },
      maxCustomerServicesPerTrip: 2,
    })

    expect(combined.tripCount).toBe(1)
    expect(combined.routeCost).toBe(6)
    expect(combined.trips[0].routeFootprint).toHaveLength(3)
    expect(
      combined.trips[0].routeFootprint.every(
        (edge) => edge.traversalCount === 2,
      ),
    ).toBe(true)
    expect(combined.trips[0].primaryRegionIds).toEqual(['b', 'c'])
    expect(combined.trips[0].transitRegionIds).toEqual(['a'])

    const bOnly = planRegionServiceTrips({
      activeWorkshop: { id: 'workshop', regionId: 'home' },
      topology,
      recipeAssignments: assignments(['recipe', ['customer-b']]),
      customerRegionById: { 'customer-b': 'b' },
      maxCustomerServicesPerTrip: 1,
    })
    const cOnly = planRegionServiceTrips({
      activeWorkshop: { id: 'workshop', regionId: 'home' },
      topology,
      recipeAssignments: assignments(['recipe', ['customer-c']]),
      customerRegionById: { 'customer-c': 'c' },
      maxCustomerServicesPerTrip: 1,
    })

    expect(bOnly.routeCost + cOnly.routeCost).toBe(8)
  })

  it('uses fewer trips when route cost is tied', () => {
    expect(
      compareRegionServicePlanScores(
        { routeCost: 6, tripCount: 1, serviceFragmentation: 3 },
        { routeCost: 6, tripCount: 2, serviceFragmentation: 0 },
      ),
    ).toBeLessThan(0)
  })

  it('uses lower Region service fragmentation only after route and trip ties', () => {
    expect(
      compareRegionServicePlanScores(
        { routeCost: 6, tripCount: 2, serviceFragmentation: 0 },
        { routeCost: 6, tripCount: 2, serviceFragmentation: 1 },
      ),
    ).toBeLessThan(0)
  })

  it('preserves recipe-to-customer assignment across workshop and topology changes', () => {
    const recipeAssignments = assignments(
      ['alpha', ['customer-1', 'customer-2']],
      ['beta', ['customer-3']],
    )
    const customerRegionById = {
      'customer-1': 'left',
      'customer-2': 'center',
      'customer-3': 'right',
    }

    const leftBased = planRegionServiceTrips({
      activeWorkshop: { id: 'left-workshop', regionId: 'left' },
      topology: {
        edges: [
          { from: 'left', to: 'center', cost: 1 },
          { from: 'center', to: 'right', cost: 1 },
        ],
      },
      recipeAssignments,
      customerRegionById,
      maxCustomerServicesPerTrip: 2,
    })
    const rightBased = planRegionServiceTrips({
      activeWorkshop: { id: 'right-workshop', regionId: 'right' },
      topology: {
        edges: [
          { from: 'left', to: 'center', cost: 3 },
          { from: 'center', to: 'right', cost: 1 },
        ],
      },
      recipeAssignments,
      customerRegionById,
      maxCustomerServicesPerTrip: 2,
    })

    expect(leftBased.trips).not.toEqual(rightBased.trips)
    expect(assignmentPairs(leftBased)).toEqual([
      'alpha:customer-1',
      'alpha:customer-2',
      'beta:customer-3',
    ])
    expect(assignmentPairs(rightBased)).toEqual(
      assignmentPairs(leftBased),
    )
  })
})
