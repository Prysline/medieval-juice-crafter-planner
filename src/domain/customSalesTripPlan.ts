import type { RegionId } from './regionServicePlanner'

export interface CustomSalesTripCustomer {
  customerId: string
  recipeId: string
  servings: number
  regionId: RegionId
  residenceId?: string | null
  routeNodeId?: string | null
}

export interface CustomSalesTripPlan {
  customersById: Readonly<Record<string, CustomSalesTripCustomer>>
  tripByCustomerId: Readonly<Record<string, string>>
  tripOrder: readonly string[]
}

export interface CustomSalesTripEditorDraft {
  customersById: Readonly<Record<string, CustomSalesTripCustomer>>
  tripByCustomerId: Readonly<Record<string, string>>
  editorTripOrder: readonly string[]
}

export interface FixedRecipeCustomerAssignment {
  recipeId: string
  customerIds: readonly string[]
}

export interface BaselinePhysicalTrip {
  tripNumber: number
  juiceJars: readonly {
    recipeId: string
    customerIds: readonly string[]
  }[]
}

export interface BuildCustomSalesTripBaselineInput {
  recipeAssignments: readonly FixedRecipeCustomerAssignment[]
  physicalTrips: readonly BaselinePhysicalTrip[]
  customerRegionById: Readonly<Record<string, RegionId>>
  customerResidenceById?: Readonly<
    Record<string, string | null | undefined>
  >
  customerRouteNodeById?: Readonly<
    Record<string, string | null | undefined>
  >
}

function stableBaselineTripId(tripNumber: number): string {
  return `auto-trip-${tripNumber}`
}

function normalizedSelection(
  plan: Pick<CustomSalesTripPlan, 'customersById'>,
  customerIds: readonly string[],
): string[] {
  const unique = [...new Set(customerIds)]
  if (unique.length === 0) {
    throw new Error('Custom trip edit requires at least one customer')
  }

  for (const customerId of unique) {
    if (!plan.customersById[customerId]) {
      throw new Error(`Unknown custom-trip customer ${customerId}`)
    }
  }

  return unique
}

function removeEmptyTrips(
  plan: CustomSalesTripPlan,
  tripByCustomerId: Readonly<Record<string, string>>,
  tripOrder: readonly string[],
): CustomSalesTripPlan {
  const usedTripIds = new Set(Object.values(tripByCustomerId))
  return {
    customersById: plan.customersById,
    tripByCustomerId,
    tripOrder: tripOrder.filter((tripId) => usedTripIds.has(tripId)),
  }
}

export function assertCustomSalesTripPlan(
  plan: CustomSalesTripPlan,
): void {
  const tripIds = new Set<string>()
  for (const tripId of plan.tripOrder) {
    if (!tripId) {
      throw new Error('Custom trip IDs must be non-empty')
    }
    if (tripIds.has(tripId)) {
      throw new Error(`Duplicate custom trip ID ${tripId}`)
    }
    tripIds.add(tripId)
  }

  const customerIds = Object.keys(plan.customersById)
  const assignedCustomerIds = Object.keys(plan.tripByCustomerId)

  if (customerIds.length !== assignedCustomerIds.length) {
    throw new Error(
      'Every custom-trip customer must have exactly one trip assignment',
    )
  }

  for (const customerId of customerIds) {
    const customer = plan.customersById[customerId]
    if (!customer || customer.customerId !== customerId) {
      throw new Error(
        `Custom-trip customer identity drifted for ${customerId}`,
      )
    }
    if (!customer.recipeId) {
      throw new Error(
        `Custom-trip customer ${customerId} requires recipeId`,
      )
    }
    if (
      !Number.isInteger(customer.servings) ||
      customer.servings <= 0
    ) {
      throw new Error(
        `Custom-trip customer ${customerId} requires positive integer servings`,
      )
    }
    if (!customer.regionId) {
      throw new Error(
        `Custom-trip customer ${customerId} requires Region identity`,
      )
    }

    const tripId = plan.tripByCustomerId[customerId]
    if (!tripId || !tripIds.has(tripId)) {
      throw new Error(
        `Custom-trip customer ${customerId} references unknown trip ${tripId ?? ''}`,
      )
    }
  }

  for (const customerId of assignedCustomerIds) {
    if (!plan.customersById[customerId]) {
      throw new Error(
        `Custom trip assignment references unknown customer ${customerId}`,
      )
    }
  }

  const customerCountByTrip = new Map<string, number>(
    plan.tripOrder.map((tripId) => [tripId, 0]),
  )
  for (const tripId of Object.values(plan.tripByCustomerId)) {
    customerCountByTrip.set(
      tripId,
      (customerCountByTrip.get(tripId) ?? 0) + 1,
    )
  }
  for (const tripId of plan.tripOrder) {
    if ((customerCountByTrip.get(tripId) ?? 0) < 1) {
      throw new Error(`Custom trip ${tripId} cannot be empty`)
    }
  }

  if (customerIds.length === 0 && plan.tripOrder.length !== 0) {
    throw new Error('Empty custom sales plan cannot contain trips')
  }
}

export function cloneCustomSalesTripPlan(
  plan: CustomSalesTripPlan,
): CustomSalesTripPlan {
  const clone: CustomSalesTripPlan = {
    customersById: Object.fromEntries(
      Object.entries(plan.customersById).map(
        ([customerId, customer]) => [
          customerId,
          { ...customer },
        ],
      ),
    ),
    tripByCustomerId: { ...plan.tripByCustomerId },
    tripOrder: [...plan.tripOrder],
  }
  assertCustomSalesTripPlan(clone)
  return clone
}


function normalizedPlanFromEditorDraft(
  draft: CustomSalesTripEditorDraft,
): CustomSalesTripPlan {
  const tripIds = new Set<string>()
  for (const tripId of draft.editorTripOrder) {
    if (!tripId) {
      throw new Error('Custom editor trip IDs must be non-empty')
    }
    if (tripIds.has(tripId)) {
      throw new Error(`Duplicate custom editor trip ID ${tripId}`)
    }
    tripIds.add(tripId)
  }

  if (
    Object.keys(draft.customersById).length === 0 &&
    draft.editorTripOrder.length !== 0
  ) {
    throw new Error('Empty custom editor draft cannot contain trips')
  }

  for (const tripId of Object.values(draft.tripByCustomerId)) {
    if (!tripIds.has(tripId)) {
      throw new Error(
        `Custom editor assignment references unknown trip ${tripId}`,
      )
    }
  }

  const usedTripIds = new Set(Object.values(draft.tripByCustomerId))
  const normalized: CustomSalesTripPlan = {
    customersById: draft.customersById,
    tripByCustomerId: draft.tripByCustomerId,
    tripOrder: draft.editorTripOrder.filter((tripId) =>
      usedTripIds.has(tripId),
    ),
  }
  assertCustomSalesTripPlan(normalized)
  return normalized
}

export function assertCustomSalesTripEditorDraft(
  draft: CustomSalesTripEditorDraft,
): void {
  normalizedPlanFromEditorDraft(draft)
}

export function buildCustomSalesTripEditorDraft(
  plan: CustomSalesTripPlan,
): CustomSalesTripEditorDraft {
  assertCustomSalesTripPlan(plan)
  const draft: CustomSalesTripEditorDraft = {
    customersById: Object.fromEntries(
      Object.entries(plan.customersById).map(
        ([customerId, customer]) => [
          customerId,
          { ...customer },
        ],
      ),
    ),
    tripByCustomerId: { ...plan.tripByCustomerId },
    editorTripOrder: [...plan.tripOrder],
  }
  assertCustomSalesTripEditorDraft(draft)
  return draft
}

export function normalizeCustomSalesTripEditorDraft(
  draft: CustomSalesTripEditorDraft,
): CustomSalesTripPlan {
  return cloneCustomSalesTripPlan(
    normalizedPlanFromEditorDraft(draft),
  )
}

export function customerIdsForCustomTripEditorDraft(
  draft: CustomSalesTripEditorDraft,
  tripId: string,
): string[] {
  if (!draft.editorTripOrder.includes(tripId)) {
    throw new Error(`Unknown custom editor trip ${tripId}`)
  }
  return Object.keys(draft.customersById).filter(
    (customerId) => draft.tripByCustomerId[customerId] === tripId,
  )
}

export function moveCustomTripEditorDraftCustomers(
  draft: CustomSalesTripEditorDraft,
  customerIds: readonly string[],
  targetTripId: string,
): CustomSalesTripEditorDraft {
  assertCustomSalesTripEditorDraft(draft)
  if (!draft.editorTripOrder.includes(targetTripId)) {
    throw new Error(`Unknown target custom editor trip ${targetTripId}`)
  }

  const selection = normalizedSelection(draft, customerIds)
  const tripByCustomerId = { ...draft.tripByCustomerId }
  for (const customerId of selection) {
    tripByCustomerId[customerId] = targetTripId
  }

  const next: CustomSalesTripEditorDraft = {
    customersById: draft.customersById,
    tripByCustomerId,
    editorTripOrder: draft.editorTripOrder,
  }
  assertCustomSalesTripEditorDraft(next)
  return next
}

export function moveCustomTripEditorDraftCustomersToNewTrip(
  draft: CustomSalesTripEditorDraft,
  customerIds: readonly string[],
  newTripId: string,
  insertAfterTripId: string,
): CustomSalesTripEditorDraft {
  assertCustomSalesTripEditorDraft(draft)
  if (!newTripId) {
    throw new Error('New custom editor trip requires a non-empty ID')
  }
  if (draft.editorTripOrder.includes(newTripId)) {
    throw new Error(`Custom editor trip ID ${newTripId} already exists`)
  }
  const insertIndex = draft.editorTripOrder.indexOf(insertAfterTripId)
  if (insertIndex < 0) {
    throw new Error(
      `Unknown custom editor trip insertion point ${insertAfterTripId}`,
    )
  }

  const selection = normalizedSelection(draft, customerIds)
  const tripByCustomerId = { ...draft.tripByCustomerId }
  for (const customerId of selection) {
    tripByCustomerId[customerId] = newTripId
  }

  const editorTripOrder = [...draft.editorTripOrder]
  editorTripOrder.splice(insertIndex + 1, 0, newTripId)

  const next: CustomSalesTripEditorDraft = {
    customersById: draft.customersById,
    tripByCustomerId,
    editorTripOrder,
  }
  assertCustomSalesTripEditorDraft(next)
  return next
}

export function swapCustomTripEditorDraftCustomers(
  draft: CustomSalesTripEditorDraft,
  firstCustomerId: string,
  secondCustomerId: string,
): CustomSalesTripEditorDraft {
  assertCustomSalesTripEditorDraft(draft)
  const selection = normalizedSelection(draft, [
    firstCustomerId,
    secondCustomerId,
  ])
  if (selection.length !== 2) {
    throw new Error(
      'Custom editor customer swap requires exactly two distinct customers',
    )
  }

  const [firstId, secondId] = selection
  const firstTripId = draft.tripByCustomerId[firstId]!
  const secondTripId = draft.tripByCustomerId[secondId]!
  if (firstTripId === secondTripId) return draft

  const next: CustomSalesTripEditorDraft = {
    customersById: draft.customersById,
    tripByCustomerId: {
      ...draft.tripByCustomerId,
      [firstId]: secondTripId,
      [secondId]: firstTripId,
    },
    editorTripOrder: draft.editorTripOrder,
  }
  assertCustomSalesTripEditorDraft(next)
  return next
}

export function removeEmptyCustomTripEditorDraftTrip(
  draft: CustomSalesTripEditorDraft,
  tripId: string,
): CustomSalesTripEditorDraft {
  assertCustomSalesTripEditorDraft(draft)
  if (!draft.editorTripOrder.includes(tripId)) {
    throw new Error(`Unknown custom editor trip ${tripId}`)
  }
  if (customerIdsForCustomTripEditorDraft(draft, tripId).length > 0) {
    throw new Error(
      `Custom editor trip ${tripId} cannot be removed while it has customers`,
    )
  }

  const next: CustomSalesTripEditorDraft = {
    customersById: draft.customersById,
    tripByCustomerId: draft.tripByCustomerId,
    editorTripOrder: draft.editorTripOrder.filter(
      (currentTripId) => currentTripId !== tripId,
    ),
  }
  assertCustomSalesTripEditorDraft(next)
  return next
}

export function clearEmptyCustomTripEditorDraftTrips(
  draft: CustomSalesTripEditorDraft,
): CustomSalesTripEditorDraft {
  assertCustomSalesTripEditorDraft(draft)
  const usedTripIds = new Set(Object.values(draft.tripByCustomerId))
  const editorTripOrder = draft.editorTripOrder.filter((tripId) =>
    usedTripIds.has(tripId),
  )
  if (editorTripOrder.length === draft.editorTripOrder.length) {
    return draft
  }

  const next: CustomSalesTripEditorDraft = {
    customersById: draft.customersById,
    tripByCustomerId: draft.tripByCustomerId,
    editorTripOrder,
  }
  assertCustomSalesTripEditorDraft(next)
  return next
}

export function mergeCustomSalesTripEditorDraftTrips(
  draft: CustomSalesTripEditorDraft,
  sourceTripId: string,
  targetTripId: string,
): CustomSalesTripEditorDraft {
  assertCustomSalesTripEditorDraft(draft)
  if (sourceTripId === targetTripId) {
    throw new Error('Cannot merge a custom editor trip into itself')
  }
  if (!draft.editorTripOrder.includes(sourceTripId)) {
    throw new Error(`Unknown source custom editor trip ${sourceTripId}`)
  }
  if (!draft.editorTripOrder.includes(targetTripId)) {
    throw new Error(`Unknown target custom editor trip ${targetTripId}`)
  }

  const sourceCustomerIds =
    customerIdsForCustomTripEditorDraft(draft, sourceTripId)
  const moved =
    sourceCustomerIds.length > 0
      ? moveCustomTripEditorDraftCustomers(
          draft,
          sourceCustomerIds,
          targetTripId,
        )
      : draft
  return removeEmptyCustomTripEditorDraftTrip(
    moved,
    sourceTripId,
  )
}

export function reorderCustomSalesTripEditorDraftTrips(
  draft: CustomSalesTripEditorDraft,
  editorTripOrder: readonly string[],
): CustomSalesTripEditorDraft {
  assertCustomSalesTripEditorDraft(draft)

  if (editorTripOrder.length !== draft.editorTripOrder.length) {
    throw new Error(
      'Custom editor trip reorder must include every existing trip exactly once',
    )
  }
  const unique = new Set(editorTripOrder)
  if (unique.size !== editorTripOrder.length) {
    throw new Error('Custom editor trip reorder contains duplicate trip IDs')
  }
  for (const tripId of draft.editorTripOrder) {
    if (!unique.has(tripId)) {
      throw new Error(
        `Custom editor trip reorder is missing trip ${tripId}`,
      )
    }
  }

  const next: CustomSalesTripEditorDraft = {
    customersById: draft.customersById,
    tripByCustomerId: draft.tripByCustomerId,
    editorTripOrder: [...editorTripOrder],
  }
  assertCustomSalesTripEditorDraft(next)
  return next
}

export function buildCustomSalesTripBaseline(
  input: BuildCustomSalesTripBaselineInput,
): CustomSalesTripPlan {
  const recipeByCustomerId = new Map<string, string>()
  for (const recipe of input.recipeAssignments) {
    if (!recipe.recipeId) {
      throw new Error(
        'Custom trip baseline recipe assignment requires recipeId',
      )
    }
    for (const customerId of recipe.customerIds) {
      if (recipeByCustomerId.has(customerId)) {
        throw new Error(
          `Customer ${customerId} appears in more than one recipe assignment`,
        )
      }
      recipeByCustomerId.set(customerId, recipe.recipeId)
    }
  }

  const customersById: Record<string, CustomSalesTripCustomer> = {}
  const tripByCustomerId: Record<string, string> = {}
  const tripOrder: string[] = []
  const seenPhysicalCustomers = new Set<string>()
  const seenTripNumbers = new Set<number>()

  for (const trip of input.physicalTrips) {
    if (
      !Number.isInteger(trip.tripNumber) ||
      trip.tripNumber <= 0 ||
      seenTripNumbers.has(trip.tripNumber)
    ) {
      throw new Error(
        `Custom trip baseline requires unique positive trip numbers: ${trip.tripNumber}`,
      )
    }
    seenTripNumbers.add(trip.tripNumber)

    const tripCustomerIds = trip.juiceJars.flatMap((load) =>
      load.customerIds.map((customerId) => ({
        customerId,
        physicalRecipeId: load.recipeId,
      })),
    )
    if (tripCustomerIds.length === 0) {
      throw new Error(
        `Custom trip baseline cannot contain empty physical trip ${trip.tripNumber}`,
      )
    }

    const tripId = stableBaselineTripId(trip.tripNumber)
    tripOrder.push(tripId)

    for (const {
      customerId,
      physicalRecipeId,
    } of tripCustomerIds) {
      if (seenPhysicalCustomers.has(customerId)) {
        throw new Error(
          `Customer ${customerId} appears in more than one physical trip`,
        )
      }
      seenPhysicalCustomers.add(customerId)

      const recipeId = recipeByCustomerId.get(customerId)
      if (!recipeId) {
        throw new Error(
          `Physical trip references customer ${customerId} without optimizer recipe assignment`,
        )
      }
      if (physicalRecipeId !== recipeId) {
        throw new Error(
          `Physical trip recipe drifted for customer ${customerId}: expected ${recipeId}, got ${physicalRecipeId}`,
        )
      }

      const regionId = input.customerRegionById[customerId]
      if (!regionId) {
        throw new Error(
          `Missing Region identity for custom-trip customer ${customerId}`,
        )
      }

      customersById[customerId] = {
        customerId,
        recipeId,
        // Current production authority is one customer per serving.
        servings: 1,
        regionId,
        residenceId:
          input.customerResidenceById?.[customerId] ?? null,
        routeNodeId:
          input.customerRouteNodeById?.[customerId] ?? null,
      }
      tripByCustomerId[customerId] = tripId
    }
  }

  for (const customerId of recipeByCustomerId.keys()) {
    if (!seenPhysicalCustomers.has(customerId)) {
      throw new Error(
        `Optimizer-assigned customer ${customerId} is missing from the physical sales plan`,
      )
    }
  }

  if (
    seenPhysicalCustomers.size !== recipeByCustomerId.size
  ) {
    throw new Error(
      'Custom trip baseline customer set drifted from optimizer recipe assignments',
    )
  }

  const plan: CustomSalesTripPlan = {
    customersById,
    tripByCustomerId,
    tripOrder,
  }
  assertCustomSalesTripPlan(plan)
  return plan
}

export function customerIdsForCustomTrip(
  plan: CustomSalesTripPlan,
  tripId: string,
): string[] {
  if (!plan.tripOrder.includes(tripId)) {
    throw new Error(`Unknown custom trip ${tripId}`)
  }
  return Object.keys(plan.customersById).filter(
    (customerId) => plan.tripByCustomerId[customerId] === tripId,
  )
}

export function moveCustomTripCustomers(
  plan: CustomSalesTripPlan,
  customerIds: readonly string[],
  targetTripId: string,
): CustomSalesTripPlan {
  assertCustomSalesTripPlan(plan)
  if (!plan.tripOrder.includes(targetTripId)) {
    throw new Error(`Unknown target custom trip ${targetTripId}`)
  }

  const selection = normalizedSelection(plan, customerIds)
  const tripByCustomerId = { ...plan.tripByCustomerId }
  for (const customerId of selection) {
    tripByCustomerId[customerId] = targetTripId
  }

  const next = removeEmptyTrips(
    plan,
    tripByCustomerId,
    plan.tripOrder,
  )
  assertCustomSalesTripPlan(next)
  return next
}

export function moveCustomTripCustomersToNewTrip(
  plan: CustomSalesTripPlan,
  customerIds: readonly string[],
  newTripId: string,
  insertAfterTripId: string,
): CustomSalesTripPlan {
  assertCustomSalesTripPlan(plan)
  if (!newTripId) {
    throw new Error('New custom trip requires a non-empty ID')
  }
  if (plan.tripOrder.includes(newTripId)) {
    throw new Error(`Custom trip ID ${newTripId} already exists`)
  }
  const insertIndex = plan.tripOrder.indexOf(insertAfterTripId)
  if (insertIndex < 0) {
    throw new Error(
      `Unknown custom trip insertion point ${insertAfterTripId}`,
    )
  }

  const selection = normalizedSelection(plan, customerIds)
  const tripByCustomerId = { ...plan.tripByCustomerId }
  for (const customerId of selection) {
    tripByCustomerId[customerId] = newTripId
  }

  const tripOrder = [...plan.tripOrder]
  tripOrder.splice(insertIndex + 1, 0, newTripId)

  const next = removeEmptyTrips(
    plan,
    tripByCustomerId,
    tripOrder,
  )
  assertCustomSalesTripPlan(next)
  return next
}

export function swapCustomTripCustomers(
  plan: CustomSalesTripPlan,
  firstCustomerId: string,
  secondCustomerId: string,
): CustomSalesTripPlan {
  assertCustomSalesTripPlan(plan)
  const selection = normalizedSelection(plan, [
    firstCustomerId,
    secondCustomerId,
  ])
  if (selection.length !== 2) {
    throw new Error(
      'Custom trip customer swap requires exactly two distinct customers',
    )
  }

  const [firstId, secondId] = selection
  const firstTripId = plan.tripByCustomerId[firstId]!
  const secondTripId = plan.tripByCustomerId[secondId]!
  if (firstTripId === secondTripId) return plan

  const next: CustomSalesTripPlan = {
    customersById: plan.customersById,
    tripByCustomerId: {
      ...plan.tripByCustomerId,
      [firstId]: secondTripId,
      [secondId]: firstTripId,
    },
    tripOrder: plan.tripOrder,
  }
  assertCustomSalesTripPlan(next)
  return next
}

export function mergeCustomSalesTrips(
  plan: CustomSalesTripPlan,
  sourceTripId: string,
  targetTripId: string,
): CustomSalesTripPlan {
  assertCustomSalesTripPlan(plan)
  if (sourceTripId === targetTripId) {
    throw new Error('Cannot merge a custom trip into itself')
  }
  if (!plan.tripOrder.includes(sourceTripId)) {
    throw new Error(`Unknown source custom trip ${sourceTripId}`)
  }
  if (!plan.tripOrder.includes(targetTripId)) {
    throw new Error(`Unknown target custom trip ${targetTripId}`)
  }

  return moveCustomTripCustomers(
    plan,
    customerIdsForCustomTrip(plan, sourceTripId),
    targetTripId,
  )
}

export function reorderCustomSalesTrips(
  plan: CustomSalesTripPlan,
  tripOrder: readonly string[],
): CustomSalesTripPlan {
  assertCustomSalesTripPlan(plan)

  if (tripOrder.length !== plan.tripOrder.length) {
    throw new Error(
      'Custom trip reorder must include every existing trip exactly once',
    )
  }
  const unique = new Set(tripOrder)
  if (unique.size !== tripOrder.length) {
    throw new Error('Custom trip reorder contains duplicate trip IDs')
  }
  for (const tripId of plan.tripOrder) {
    if (!unique.has(tripId)) {
      throw new Error(
        `Custom trip reorder is missing trip ${tripId}`,
      )
    }
  }

  const next: CustomSalesTripPlan = {
    customersById: plan.customersById,
    tripByCustomerId: plan.tripByCustomerId,
    tripOrder: [...tripOrder],
  }
  assertCustomSalesTripPlan(next)
  return next
}
