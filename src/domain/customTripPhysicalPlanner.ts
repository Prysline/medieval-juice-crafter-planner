import type { JuiceJarInventoryItem } from '../types'
import {
  assertCustomSalesTripPlan,
  customerIdsForCustomTrip,
  type CustomSalesTripPlan,
} from './customSalesTripPlan'
import {
  buildMultiTripReplenishmentPlan,
  type CupInventoryInput,
  type MultiTripJarCarryPolicy,
  type MultiTripReplenishmentPlan,
  type UsedCupTripPolicy,
} from './multiTripReplenishment'
import {
  PlanningUserError,
  presentPlanningError,
} from './planningErrors'
import type { PreparationDemand } from './preparationDemand'
import type { PreparationShortfall } from './preparationShortfall'

export type CustomTripPhysicalIssueCategory =
  | 'carrying-capacity'
  | 'juice-availability'
  | 'replenishment-wash'
  | 'leftover-conflict'
  | 'physical-realization'

export interface CustomTripPhysicalIssue {
  category: CustomTripPhysicalIssueCategory
  tripId?: string
  recipeId?: string
  message: string
  suggestions: string[]
}

export type CustomTripPhysicalValidationResult =
  | {
      status: 'valid'
      salesPlan: MultiTripReplenishmentPlan
      issues: []
    }
  | {
      status: 'invalid'
      salesPlan: null
      issues: CustomTripPhysicalIssue[]
    }

export interface ValidateCustomTripPhysicalPlanInput {
  customPlan: CustomSalesTripPlan
  demand: PreparationDemand
  shortfall: PreparationShortfall
  policy: UsedCupTripPolicy
  availableJuiceJarInventory: JuiceJarInventoryItem[]
  cups: CupInventoryInput
  carryPolicy?: MultiTripJarCarryPolicy
  allowDiscardRetainedJuice?: boolean
}

function assertRecipeAuthority(
  customPlan: CustomSalesTripPlan,
  demand: PreparationDemand,
): void {
  const demandRecipeByCustomerId = new Map<string, string>()
  for (const recipe of demand.recipes) {
    for (const customerId of recipe.customerIds) {
      if (demandRecipeByCustomerId.has(customerId)) {
        throw new Error(
          `Preparation demand assigns customer ${customerId} more than once`,
        )
      }
      demandRecipeByCustomerId.set(customerId, recipe.recipeId)
    }
  }

  const customCustomerIds = Object.keys(customPlan.customersById)
  if (customCustomerIds.length !== demandRecipeByCustomerId.size) {
    throw new Error(
      'Custom trip customer set drifted from preparation demand',
    )
  }

  for (const customerId of customCustomerIds) {
    const customer = customPlan.customersById[customerId]
    const demandRecipeId = demandRecipeByCustomerId.get(customerId)
    if (!customer || !demandRecipeId) {
      throw new Error(
        `Custom trip customer ${customerId} is missing from preparation demand`,
      )
    }
    if (customer.recipeId !== demandRecipeId) {
      throw new Error(
        `Custom trip recipe drifted for customer ${customerId}: expected ${demandRecipeId}, got ${customer.recipeId}`,
      )
    }
    if (customer.servings !== 1) {
      throw new Error(
        `Custom trip servings drifted for customer ${customerId}: current production authority requires exactly one serving`,
      )
    }
  }
}

function issueCategory(
  error: PlanningUserError,
): CustomTripPhysicalIssueCategory {
  switch (error.code) {
    case 'missing-physical-jar':
    case 'jar-storage-overflow':
    case 'missing-jar-slot':
    case 'trip-capacity':
      return 'carrying-capacity'
    case 'missing-physical-cup':
      return 'replenishment-wash'
    case 'leftover-storage':
    case 'retained-juice-conflict':
      return 'leftover-conflict'
    case 'fixed-trip-realization':
    case 'jar-schedule-inconsistency':
    case 'optimizer-no-solution':
      return 'physical-realization'
  }
}

function issueForError(
  error: unknown,
  customPlan: CustomSalesTripPlan,
): CustomTripPhysicalIssue {
  const presentation = presentPlanningError(error)
  if (error instanceof PlanningUserError) {
    const fixedTripNumber = error.context.fixedTripNumber
    const tripId =
      typeof fixedTripNumber === 'number'
        ? customPlan.tripOrder[fixedTripNumber - 1]
        : undefined

    return {
      category: issueCategory(error),
      tripId,
      message: presentation.message,
      suggestions: presentation.suggestions,
    }
  }

  return {
    category: 'physical-realization',
    message: presentation.message,
    suggestions: presentation.suggestions,
  }
}

export function validateCustomTripPhysicalPlan(
  input: ValidateCustomTripPhysicalPlanInput,
): CustomTripPhysicalValidationResult {
  try {
    assertCustomSalesTripPlan(input.customPlan)
    assertRecipeAuthority(input.customPlan, input.demand)

    const fixedCustomerTrips = input.customPlan.tripOrder.map(
      (tripId) => ({
        customerIds: customerIdsForCustomTrip(
          input.customPlan,
          tripId,
        ),
      }),
    )

    const salesPlan = buildMultiTripReplenishmentPlan(
      input.demand,
      input.policy,
      input.availableJuiceJarInventory,
      input.cups,
      input.shortfall,
      input.carryPolicy,
      input.allowDiscardRetainedJuice ?? false,
      { fixedCustomerTrips },
    )

    return {
      status: 'valid',
      salesPlan,
      issues: [],
    }
  } catch (error) {
    return {
      status: 'invalid',
      salesPlan: null,
      issues: [issueForError(error, input.customPlan)],
    }
  }
}
