import {
  planRegionServiceTrips,
  type ActiveWorkshop,
  type RegionId,
  type RegionServicePlan,
  type RegionTopologyEdge,
} from './regionServicePlanner'

export interface FixedRecipeCustomerAssignment {
  recipeId: string
  recipeName: string
  customerIds: readonly string[]
}

export interface RemainingSalesRecipeDemand {
  recipeId: string
  recipeName: string
  servings: number
  customerIds: string[]
}

export interface RemainingSalesTripPlan {
  totalCustomerCount: number
  remainingCustomerCount: number
  suppliedCustomerCount: number
  maxCustomerServicesPerTrip: number
  recipes: RemainingSalesRecipeDemand[]
  regionPlan: RegionServicePlan
}

export interface RemainingSalesTripPlannerInput {
  recipeAssignments: readonly FixedRecipeCustomerAssignment[]
  suppliedCustomerIds: readonly string[]
  originalTripServingCounts: readonly number[]
  activeWorkshop: ActiveWorkshop
  topology: {
    edges: readonly RegionTopologyEdge[]
  }
  customerRegionById: Readonly<Record<string, RegionId>>
}

/**
 * Replans only the still-undelivered sales itinerary.
 *
 * Recipe assignment is immutable here: supplied customers are removed from the
 * original customer -> recipe assignment, and the remaining customers are only
 * regrouped by Region/trip. This helper intentionally has no inventory,
 * production, jar, cup, or transaction inputs.
 */
export function buildRemainingSalesTripPlan(
  input: RemainingSalesTripPlannerInput,
): RemainingSalesTripPlan {
  const suppliedCustomerIds = new Set(input.suppliedCustomerIds)
  const totalCustomerCount = input.recipeAssignments.reduce(
    (sum, recipe) => sum + recipe.customerIds.length,
    0,
  )
  const recipes = input.recipeAssignments
    .map((recipe): RemainingSalesRecipeDemand => {
      const customerIds = recipe.customerIds.filter(
        (customerId) => !suppliedCustomerIds.has(customerId),
      )
      return {
        recipeId: recipe.recipeId,
        recipeName: recipe.recipeName,
        servings: customerIds.length,
        customerIds,
      }
    })
    .filter((recipe) => recipe.servings > 0)

  const remainingCustomerCount = recipes.reduce(
    (sum, recipe) => sum + recipe.servings,
    0,
  )
  const maxCustomerServicesPerTrip = Math.max(
    1,
    ...input.originalTripServingCounts.filter(
      (servings) => Number.isInteger(servings) && servings > 0,
    ),
  )

  const regionPlan = planRegionServiceTrips({
    activeWorkshop: input.activeWorkshop,
    topology: input.topology,
    recipeAssignments: recipes.map((recipe) => ({
      recipeId: recipe.recipeId,
      customerIds: recipe.customerIds,
    })),
    customerRegionById: input.customerRegionById,
    maxCustomerServicesPerTrip,
  })

  return {
    totalCustomerCount,
    remainingCustomerCount,
    suppliedCustomerCount:
      totalCustomerCount - remainingCustomerCount,
    maxCustomerServicesPerTrip,
    recipes,
    regionPlan,
  }
}
