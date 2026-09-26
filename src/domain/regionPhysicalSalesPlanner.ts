import type { JuiceJarInventoryItem } from '../types'
import type {
  PreparationDemand,
  PreparationRecipeDemand,
} from './preparationDemand'
import type { PreparationShortfall } from './preparationShortfall'
import {
  buildMultiTripReplenishmentPlan,
  type CupInventoryInput,
  type MultiTripJarCarryPolicy,
  type MultiTripReplenishmentPlan,
  type MultiTripSalesTrip,
  type UsedCupTripPolicy,
} from './multiTripReplenishment'
import {
  buildRegionRouteFootprint,
  compareRegionServicePlanScores,
  planRegionServiceTrips,
  type ActiveWorkshop,
  type RegionId,
  type RegionRouteFootprintEdge,
  type RegionServicePlan,
  type RegionServicePlanScore,
  type RegionTopologyEdge,
} from './regionServicePlanner'

export interface RegionRecipeServingDemand {
  recipeId: string
  recipeName: string
  servings: number
}

export interface RegionRequiredService {
  regionId: RegionId
  totalServings: number
  recipes: RegionRecipeServingDemand[]
}

export interface RealizedRegionTripService {
  regionId: RegionId
  role: 'primary' | 'side'
  customerIds: string[]
  recipes: RegionRecipeServingDemand[]
}

export interface RegionPhysicalSalesTrip {
  tripNumber: number
  physicalTrip: MultiTripSalesTrip
  services: RealizedRegionTripService[]
  servicedRegionIds: RegionId[]
  primaryRegionIds: RegionId[]
  sideRegionIds: RegionId[]
  transitRegionIds: RegionId[]
  routeFootprint: RegionRouteFootprintEdge[]
  routeCost: number
}

export interface RegionPhysicalSalesPlan
  extends RegionServicePlanScore {
  activeWorkshop: ActiveWorkshop
  regionServiceIntent: RegionServicePlan
  requiredByRegion: RegionRequiredService[]
  salesPlan: MultiTripReplenishmentPlan
  trips: RegionPhysicalSalesTrip[]
}

export interface BuildRegionPhysicalSalesPlanInput {
  demand: PreparationDemand
  shortfall: PreparationShortfall
  policy: UsedCupTripPolicy
  availableJuiceJarInventory: JuiceJarInventoryItem[]
  cups: CupInventoryInput
  carryPolicy?: MultiTripJarCarryPolicy
  allowDiscardRetainedJuice?: boolean
  activeWorkshop: ActiveWorkshop
  topology: {
    edges: readonly RegionTopologyEdge[]
  }
  customerRegionById: Readonly<Record<string, RegionId>>
}

function regionForCustomer(
  customerId: string,
  customerRegionById: Readonly<Record<string, RegionId>>,
): RegionId {
  const regionId = customerRegionById[customerId]
  if (!regionId) {
    throw new Error(
      `Missing Region identity for customer ${customerId}`,
    )
  }
  return regionId
}

function requiredByRegion(
  demand: PreparationDemand,
  customerRegionById: Readonly<Record<string, RegionId>>,
): RegionRequiredService[] {
  const byRegion = new Map<
    RegionId,
    Map<string, RegionRecipeServingDemand>
  >()

  for (const recipe of demand.recipes) {
    for (const customerId of recipe.customerIds) {
      const regionId = regionForCustomer(
        customerId,
        customerRegionById,
      )
      const recipes =
        byRegion.get(regionId) ??
        new Map<string, RegionRecipeServingDemand>()
      const current = recipes.get(recipe.recipeId) ?? {
        recipeId: recipe.recipeId,
        recipeName: recipe.recipeName,
        servings: 0,
      }
      current.servings += 1
      recipes.set(recipe.recipeId, current)
      byRegion.set(regionId, recipes)
    }
  }

  return [...byRegion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([regionId, recipes]) => {
      const recipeList = [...recipes.values()].sort(
        (a, b) =>
          a.recipeName.localeCompare(
            b.recipeName,
            'zh-Hant',
          ) ||
          a.recipeId.localeCompare(b.recipeId),
      )
      return {
        regionId,
        totalServings: recipeList.reduce(
          (sum, recipe) => sum + recipe.servings,
          0,
        ),
        recipes: recipeList,
      }
    })
}

function tripPreferenceByCustomerId(
  servicePlan: RegionServicePlan,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const trip of servicePlan.trips) {
    for (const service of trip.services) {
      for (const assignment of service.customerAssignments) {
        result[assignment.customerId] = trip.tripNumber
      }
    }
  }
  return result
}

function reorderRecipeCustomers(
  recipe: PreparationRecipeDemand,
  preferenceByCustomerId: Readonly<Record<string, number>>,
): PreparationRecipeDemand {
  const originalIndex = new Map(
    recipe.customerIds.map((customerId, index) => [
      customerId,
      index,
    ]),
  )

  return {
    ...recipe,
    customerIds: [...recipe.customerIds].sort(
      (a, b) =>
        (preferenceByCustomerId[a] ??
          Number.MAX_SAFE_INTEGER) -
          (preferenceByCustomerId[b] ??
            Number.MAX_SAFE_INTEGER) ||
        (originalIndex.get(a) ?? 0) -
          (originalIndex.get(b) ?? 0),
    ),
  }
}

function demandForRegionServicePlan(
  demand: PreparationDemand,
  preferenceByCustomerId: Readonly<Record<string, number>>,
): PreparationDemand {
  return {
    ...demand,
    recipes: demand.recipes.map((recipe) =>
      reorderRecipeCustomers(
        recipe,
        preferenceByCustomerId,
      ),
    ),
  }
}

function describePhysicalTrips(
  salesPlan: MultiTripReplenishmentPlan,
  activeWorkshop: ActiveWorkshop,
  topology: { edges: readonly RegionTopologyEdge[] },
  customerRegionById: Readonly<Record<string, RegionId>>,
): {
  trips: RegionPhysicalSalesTrip[]
  score: RegionServicePlanScore
} {
  const serviceCountByRegion = new Map<RegionId, number>()

  const trips = salesPlan.trips.map(
    (physicalTrip): RegionPhysicalSalesTrip => {
      const assignments = physicalTrip.juiceJars.flatMap(
        (load) =>
          load.customerIds.map((customerId) => ({
            customerId,
            recipeId: load.recipeId,
            recipeName: load.recipeName,
            regionId: regionForCustomer(
              customerId,
              customerRegionById,
            ),
          })),
      )
      const servicedRegionIds = [
        ...new Set(
          assignments.map(
            (assignment) => assignment.regionId,
          ),
        ),
      ].sort()

      const footprint = buildRegionRouteFootprint({
        activeWorkshop,
        topology,
        servicedRegionIds,
      })
      const primarySet = new Set(
        footprint.primaryRegionIds,
      )

      const services = servicedRegionIds.map(
        (regionId): RealizedRegionTripService => {
          const regionAssignments = assignments.filter(
            (assignment) =>
              assignment.regionId === regionId,
          )
          const recipeById = new Map<
            string,
            RegionRecipeServingDemand
          >()
          for (const assignment of regionAssignments) {
            const current =
              recipeById.get(assignment.recipeId) ?? {
                recipeId: assignment.recipeId,
                recipeName: assignment.recipeName,
                servings: 0,
              }
            current.servings += 1
            recipeById.set(
              assignment.recipeId,
              current,
            )
          }

          serviceCountByRegion.set(
            regionId,
            (serviceCountByRegion.get(regionId) ?? 0) + 1,
          )

          return {
            regionId,
            role: primarySet.has(regionId)
              ? 'primary'
              : 'side',
            customerIds: regionAssignments.map(
              (assignment) => assignment.customerId,
            ),
            recipes: [...recipeById.values()].sort(
              (a, b) =>
                a.recipeName.localeCompare(
                  b.recipeName,
                  'zh-Hant',
                ) ||
                a.recipeId.localeCompare(b.recipeId),
            ),
          }
        },
      )

      return {
        tripNumber: physicalTrip.tripNumber,
        physicalTrip,
        services,
        servicedRegionIds,
        primaryRegionIds: footprint.primaryRegionIds,
        sideRegionIds: footprint.sideRegionIds,
        transitRegionIds: footprint.transitRegionIds,
        routeFootprint: footprint.edges,
        routeCost: footprint.routeCost,
      }
    },
  )

  return {
    trips,
    score: {
      routeCost: trips.reduce(
        (sum, trip) => sum + trip.routeCost,
        0,
      ),
      tripCount: trips.length,
      serviceFragmentation: [
        ...serviceCountByRegion.values(),
      ].reduce(
        (sum, count) => sum + Math.max(0, count - 1),
        0,
      ),
    },
  }
}

function recipeAssignments(
  demand: PreparationDemand,
): Array<{ recipeId: string; customerIds: string[] }> {
  return demand.recipes.map((recipe) => ({
    recipeId: recipe.recipeId,
    customerIds: [...recipe.customerIds],
  }))
}

function buildPhysicalPlan(
  input: BuildRegionPhysicalSalesPlanInput,
  demand: PreparationDemand,
  preferenceByCustomerId?: Readonly<Record<string, number>>,
): MultiTripReplenishmentPlan {
  return buildMultiTripReplenishmentPlan(
    demand,
    input.policy,
    input.availableJuiceJarInventory,
    input.cups,
    input.shortfall,
    input.carryPolicy,
    input.allowDiscardRetainedJuice ?? false,
    {
      customerTripPreferenceById:
        preferenceByCustomerId,
    },
  )
}

export function buildRegionPhysicalSalesPlan(
  input: BuildRegionPhysicalSalesPlanInput,
): RegionPhysicalSalesPlan {
  const baselineSalesPlan = buildPhysicalPlan(
    input,
    input.demand,
  )
  const abstractPhysicalCapacity = Math.max(
    1,
    ...baselineSalesPlan.trips.map(
      (trip) => trip.totalServings,
    ),
  )

  const regionServiceIntent = planRegionServiceTrips({
    activeWorkshop: input.activeWorkshop,
    topology: input.topology,
    recipeAssignments: recipeAssignments(input.demand),
    customerRegionById: input.customerRegionById,
    maxCustomerServicesPerTrip:
      abstractPhysicalCapacity,
  })
  const preferenceByCustomerId =
    tripPreferenceByCustomerId(regionServiceIntent)
  const regionOrderedDemand =
    demandForRegionServicePlan(
      input.demand,
      preferenceByCustomerId,
    )
  const regionSalesPlan = buildPhysicalPlan(
    input,
    regionOrderedDemand,
    preferenceByCustomerId,
  )

  const baseline = describePhysicalTrips(
    baselineSalesPlan,
    input.activeWorkshop,
    input.topology,
    input.customerRegionById,
  )
  const regional = describePhysicalTrips(
    regionSalesPlan,
    input.activeWorkshop,
    input.topology,
    input.customerRegionById,
  )

  const selected =
    compareRegionServicePlanScores(
      regional.score,
      baseline.score,
    ) < 0
      ? {
          salesPlan: regionSalesPlan,
          realized: regional,
        }
      : {
          salesPlan: baselineSalesPlan,
          realized: baseline,
        }

  return {
    activeWorkshop: { ...input.activeWorkshop },
    regionServiceIntent,
    requiredByRegion: requiredByRegion(
      input.demand,
      input.customerRegionById,
    ),
    salesPlan: selected.salesPlan,
    trips: selected.realized.trips,
    routeCost: selected.realized.score.routeCost,
    tripCount: selected.realized.score.tripCount,
    serviceFragmentation:
      selected.realized.score.serviceFragmentation,
  }
}
