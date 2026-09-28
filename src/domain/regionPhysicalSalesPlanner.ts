import type { JuiceJarInventoryItem } from '../types'
import type {
  PreparationDemand,
  PreparationRecipeDemand,
} from './preparationDemand'
import type { PreparationShortfall } from './preparationShortfall'
import { PlanningUserError } from './planningErrors'
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

function regionPhasePreferenceByCustomerId(
  servicePlan: RegionServicePlan,
): Record<string, number> {
  const phaseByRegion = new Map<RegionId, number>()
  for (const trip of servicePlan.trips) {
    for (const service of trip.services) {
      if (!phaseByRegion.has(service.regionId)) {
        phaseByRegion.set(service.regionId, trip.tripNumber)
      }
    }
  }

  return Object.fromEntries(
    servicePlan.customerAssignments.map((assignment) => [
      assignment.customerId,
      phaseByRegion.get(assignment.regionId) ??
        Number.MAX_SAFE_INTEGER,
    ]),
  )
}

function segmentPreferenceByCustomerId(
  servicePlan: RegionServicePlan,
  direction: 'earliest' | 'latest',
): Record<string, number> {
  const rawPreference =
    tripPreferenceByCustomerId(servicePlan)
  const assignmentsBySegment = new Map<
    string,
    RegionServicePlan['customerAssignments']
  >()

  for (const assignment of servicePlan.customerAssignments) {
    const key =
      `${assignment.recipeId}\u001f${assignment.regionId}`
    const current = assignmentsBySegment.get(key) ?? []
    current.push(assignment)
    assignmentsBySegment.set(key, current)
  }

  const preferenceByCustomerId: Record<string, number> = {}
  for (const assignments of assignmentsBySegment.values()) {
    const preferences = assignments
      .map(
        (assignment) =>
          rawPreference[assignment.customerId],
      )
      .filter((value) => Number.isFinite(value))
    const preference =
      direction === 'earliest'
        ? Math.min(...preferences)
        : Math.max(...preferences)

    for (const assignment of assignments) {
      preferenceByCustomerId[assignment.customerId] =
        preference
    }
  }

  return preferenceByCustomerId
}

function customerPreferenceSignature(
  preferenceByCustomerId: Readonly<Record<string, number>>,
): string {
  return Object.entries(preferenceByCustomerId)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([customerId, preference]) =>
      `${customerId}:${preference}`,
    )
    .join('|')
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


export interface DescribeRealizedRegionPhysicalSalesPlanInput {
  demand: PreparationDemand
  salesPlan: MultiTripReplenishmentPlan
  activeWorkshop: ActiveWorkshop
  topology: {
    edges: readonly RegionTopologyEdge[]
  }
  customerRegionById: Readonly<Record<string, RegionId>>
}

/**
 * Describes an already-realized physical plan without running Region
 * candidate search or changing customer → trip assignments.
 *
 * Custom-trip execution uses this after strict fixed-trip realization so the
 * existing Region UI can reflect the player's exact plan without handing it
 * back to the auto Region optimizer.
 */
export function describeRealizedRegionPhysicalSalesPlan(
  input: DescribeRealizedRegionPhysicalSalesPlanInput,
): RegionPhysicalSalesPlan {
  const realized = describePhysicalTrips(
    input.salesPlan,
    input.activeWorkshop,
    input.topology,
    input.customerRegionById,
  )
  const customerAssignments =
    input.demand.recipes.flatMap((recipe) =>
      recipe.customerIds.map((customerId) => ({
        customerId,
        recipeId: recipe.recipeId,
        regionId: regionForCustomer(
          customerId,
          input.customerRegionById,
        ),
      })),
    )
  const assignmentByCustomerId = new Map(
    customerAssignments.map((assignment) => [
      assignment.customerId,
      assignment,
    ]),
  )

  const regionServiceIntent: RegionServicePlan = {
    activeWorkshop: { ...input.activeWorkshop },
    customerAssignments,
    trips: realized.trips.map((trip) => ({
      tripNumber: trip.tripNumber,
      services: trip.services.map((service) => ({
        regionId: service.regionId,
        role: service.role,
        customerAssignments: service.customerIds.map(
          (customerId) => {
            const assignment =
              assignmentByCustomerId.get(customerId)
            if (!assignment) {
              throw new Error(
                `Realized Region trip references unknown customer ${customerId}`,
              )
            }
            return assignment
          },
        ),
      })),
      servicedRegionIds: [...trip.servicedRegionIds],
      primaryRegionIds: [...trip.primaryRegionIds],
      sideRegionIds: [...trip.sideRegionIds],
      transitRegionIds: [...trip.transitRegionIds],
      routeFootprint: trip.routeFootprint.map((edge) => ({
        ...edge,
      })),
      routeCost: trip.routeCost,
    })),
    routeCost: realized.score.routeCost,
    tripCount: realized.score.tripCount,
    serviceFragmentation:
      realized.score.serviceFragmentation,
  }

  return {
    activeWorkshop: { ...input.activeWorkshop },
    regionServiceIntent,
    requiredByRegion: requiredByRegion(
      input.demand,
      input.customerRegionById,
    ),
    salesPlan: input.salesPlan,
    trips: realized.trips,
    routeCost: realized.score.routeCost,
    tripCount: realized.score.tripCount,
    serviceFragmentation:
      realized.score.serviceFragmentation,
  }
}

function baselineRegionOrder(
  salesPlan: MultiTripReplenishmentPlan,
  customerRegionById: Readonly<Record<string, RegionId>>,
): RegionId[] {
  const result: RegionId[] = []
  const seen = new Set<RegionId>()

  for (const trip of salesPlan.trips) {
    for (const load of trip.juiceJars) {
      for (const customerId of load.customerIds) {
        const regionId = regionForCustomer(
          customerId,
          customerRegionById,
        )
        if (seen.has(regionId)) continue
        seen.add(regionId)
        result.push(regionId)
      }
    }
  }

  return result
}

function preferenceSignature(
  servicePlan: RegionServicePlan,
): string {
  return servicePlan.trips
    .map((trip) =>
      trip.services
        .map((service) =>
          service.customerAssignments
            .map((assignment) => assignment.customerId)
            .join(','),
        )
        .join('+'),
    )
    .join('|')
}


interface RegionPreferenceSegment {
  recipeId: string
  regionId: RegionId
  customerIds: string[]
}


function buildRegionServiceIntentFromPreference(
  input: BuildRegionPhysicalSalesPlanInput,
  preferenceByCustomerId: Readonly<Record<string, number>>,
): RegionServicePlan {
  const customerAssignments = input.demand.recipes.flatMap((recipe) =>
    recipe.customerIds.map((customerId) => ({
      customerId,
      recipeId: recipe.recipeId,
      regionId: regionForCustomer(
        customerId,
        input.customerRegionById,
      ),
    })),
  )
  const grouped = new Map<
    number,
    Map<RegionId, RegionServicePlan['customerAssignments']>
  >()

  for (const assignment of customerAssignments) {
    const preferred =
      preferenceByCustomerId[assignment.customerId]
    if (!Number.isFinite(preferred)) {
      throw new Error(
        `Missing Region trip preference for customer ${assignment.customerId}`,
      )
    }
    const tripNumber = Math.max(1, Math.floor(preferred))
    const byRegion =
      grouped.get(tripNumber) ??
      new Map<RegionId, RegionServicePlan['customerAssignments']>()
    const assignments =
      byRegion.get(assignment.regionId) ?? []
    assignments.push(assignment)
    byRegion.set(assignment.regionId, assignments)
    grouped.set(tripNumber, byRegion)
  }

  const orderedTripNumbers = [...grouped.keys()].sort(
    (a, b) => a - b,
  )
  const serviceCountByRegion = new Map<RegionId, number>()
  const trips = orderedTripNumbers.map((tripNumber, index) => {
    const byRegion = grouped.get(tripNumber)
    if (!byRegion) {
      throw new Error(
        `Missing grouped Region preference trip ${tripNumber}`,
      )
    }
    const servicedRegionIds = [...byRegion.keys()].sort()
    const footprint = buildRegionRouteFootprint({
      activeWorkshop: input.activeWorkshop,
      topology: input.topology,
      servicedRegionIds,
    })
    const primarySet = new Set(footprint.primaryRegionIds)
    const services = servicedRegionIds.map((regionId) => {
      serviceCountByRegion.set(
        regionId,
        (serviceCountByRegion.get(regionId) ?? 0) + 1,
      )
      return {
        regionId,
        role: primarySet.has(regionId)
          ? ('primary' as const)
          : ('side' as const),
        customerAssignments: byRegion.get(regionId) ?? [],
      }
    })

    return {
      tripNumber: index + 1,
      services,
      servicedRegionIds,
      primaryRegionIds: footprint.primaryRegionIds,
      sideRegionIds: footprint.sideRegionIds,
      transitRegionIds: footprint.transitRegionIds,
      routeFootprint: footprint.edges,
      routeCost: footprint.routeCost,
    }
  })

  return {
    activeWorkshop: { ...input.activeWorkshop },
    customerAssignments,
    trips,
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
  }
}

function boundedPhysicalAwareRegionPreferences(
  input: BuildRegionPhysicalSalesPlanInput,
  baselineSalesPlan: MultiTripReplenishmentPlan,
  capacity: number,
): Array<{
  regionServiceIntent: RegionServicePlan
  preferenceByCustomerId: Record<string, number>
}> {
  const jarCount = input.availableJuiceJarInventory.length
  if (jarCount < 1) return []

  const segmentsByRegion = new Map<
    RegionId,
    RegionPreferenceSegment[]
  >()
  const segmentCountByRecipe = new Map<string, number>()
  const terminalRecipeIds = new Set(
    input.demand.recipes
      .filter((recipe) => recipe.leftoverServings > 0)
      .map((recipe) => recipe.recipeId),
  )
  const initiallyOccupiedRecipeIds = new Set(
    input.shortfall.recipes
      .filter((recipe) =>
        recipe.finishedStockSources.some(
          (source) => source.servingsUsed > 0,
        ),
      )
      .map((recipe) => recipe.recipeId),
  )

  for (const recipe of input.demand.recipes) {
    const customerIdsByRegion = new Map<RegionId, string[]>()
    for (const customerId of recipe.customerIds) {
      const regionId = regionForCustomer(
        customerId,
        input.customerRegionById,
      )
      const current = customerIdsByRegion.get(regionId) ?? []
      current.push(customerId)
      customerIdsByRegion.set(regionId, current)
    }

    for (const [regionId, customerIds] of customerIdsByRegion) {
      for (
        let offset = 0;
        offset < customerIds.length;
        offset += capacity
      ) {
        const segment: RegionPreferenceSegment = {
          recipeId: recipe.recipeId,
          regionId,
          customerIds: customerIds.slice(
            offset,
            offset + capacity,
          ),
        }
        const regionSegments =
          segmentsByRegion.get(regionId) ?? []
        regionSegments.push(segment)
        segmentsByRegion.set(regionId, regionSegments)
        segmentCountByRecipe.set(
          recipe.recipeId,
          (segmentCountByRecipe.get(recipe.recipeId) ?? 0) + 1,
        )
      }
    }
  }

  const regions = [...segmentsByRegion.keys()].sort()
  const totalSegmentCount = [...segmentsByRegion.values()]
    .reduce((sum, segments) => sum + segments.length, 0)
  const stateSpaceUpperBound = regions.reduce(
    (product, regionId) =>
      product *
      ((segmentsByRegion.get(regionId)?.length ?? 0) + 1),
    1,
  )
  if (
    totalSegmentCount === 0 ||
    totalSegmentCount > 64 ||
    regions.length > 6 ||
    jarCount > 8 ||
    stateSpaceUpperBound > 50_000
  ) {
    return []
  }

  type CandidateAction = {
    servings: number
    regionIds: RegionId[]
    segments: RegionPreferenceSegment[]
    nextCursors: number[]
    signature: string
  }
  type CandidatePlan = {
    score: RegionServicePlanScore
    actions: CandidateAction[]
    signature: string
  }

  const consumedSegmentCountByRecipe = (
    cursors: readonly number[],
  ): Map<string, number> => {
    const result = new Map<string, number>()
    regions.forEach((regionId, regionIndex) => {
      const segments = segmentsByRegion.get(regionId) ?? []
      for (
        let index = 0;
        index < (cursors[regionIndex] ?? 0);
        index += 1
      ) {
        const recipeId = segments[index]?.recipeId
        if (!recipeId) continue
        result.set(
          recipeId,
          (result.get(recipeId) ?? 0) + 1,
        )
      }
    })
    return result
  }

  const occupiedRecipeIds = (
    cursors: readonly number[],
  ): Set<string> => {
    const consumed = consumedSegmentCountByRecipe(cursors)
    const occupied = new Set<string>()
    for (const [recipeId, totalCount] of segmentCountByRecipe) {
      const consumedCount = consumed.get(recipeId) ?? 0
      const hasStarted =
        consumedCount > 0 ||
        initiallyOccupiedRecipeIds.has(recipeId)
      if (
        hasStarted &&
        (
          consumedCount < totalCount ||
          terminalRecipeIds.has(recipeId)
        )
      ) {
        occupied.add(recipeId)
      }
    }
    return occupied
  }

  const enumerateActions = (
    cursors: readonly number[],
  ): CandidateAction[] => {
    const actions: CandidateAction[] = []
    const occupiedBefore = occupiedRecipeIds(cursors)

    const visit = (
      regionIndex: number,
      servings: number,
      selectedSegments: RegionPreferenceSegment[],
      selectedRegionIds: RegionId[],
      nextCursors: number[],
    ): void => {
      if (regionIndex === regions.length) {
        if (selectedSegments.length === 0) return

        const recipesDuringTrip = new Set(occupiedBefore)
        selectedSegments.forEach((segment) =>
          recipesDuringTrip.add(segment.recipeId),
        )
        if (recipesDuringTrip.size > jarCount) return

        const occupiedAfter = occupiedRecipeIds(nextCursors)
        if (occupiedAfter.size > jarCount) return

        actions.push({
          servings,
          regionIds: selectedRegionIds,
          segments: selectedSegments,
          nextCursors,
          signature: selectedSegments
            .map((segment) =>
              `${segment.recipeId}@${segment.regionId}`,
            )
            .join('+'),
        })
        return
      }

      const regionId = regions[regionIndex]
      const regionSegments =
        segmentsByRegion.get(regionId) ?? []
      const cursor = cursors[regionIndex] ?? 0

      visit(
        regionIndex + 1,
        servings,
        selectedSegments,
        selectedRegionIds,
        nextCursors,
      )

      let nextServings = servings
      const prefix: RegionPreferenceSegment[] = []
      for (
        let takeCount = 1;
        cursor + takeCount <= regionSegments.length;
        takeCount += 1
      ) {
        const segment =
          regionSegments[cursor + takeCount - 1]
        if (!segment) break
        nextServings += segment.customerIds.length
        if (nextServings > capacity) break
        prefix.push(segment)

        const candidateSegments = [
          ...selectedSegments,
          ...prefix,
        ]
        const recipesDuringTrip = new Set(occupiedBefore)
        candidateSegments.forEach((item) =>
          recipesDuringTrip.add(item.recipeId),
        )
        if (recipesDuringTrip.size > jarCount) break

        const candidateCursors = [...nextCursors]
        candidateCursors[regionIndex] =
          cursor + takeCount
        visit(
          regionIndex + 1,
          nextServings,
          candidateSegments,
          [
            ...selectedRegionIds,
            regionId,
          ],
          candidateCursors,
        )
      }
    }

    visit(
      0,
      0,
      [],
      [],
      [...cursors],
    )
    return actions
  }

  const memo = new Map<string, CandidatePlan | null>()
  let visitedStateCount = 0

  const solve = (cursors: readonly number[]): CandidatePlan | null => {
    const key = cursors.join(',')
    if (memo.has(key)) return memo.get(key) ?? null
    visitedStateCount += 1
    if (visitedStateCount > 50_000) {
      memo.set(key, null)
      return null
    }

    const complete = regions.every(
      (regionId, regionIndex) =>
        (cursors[regionIndex] ?? 0) ===
        (segmentsByRegion.get(regionId)?.length ?? 0),
    )
    if (complete) {
      const result: CandidatePlan = {
        score: {
          routeCost: 0,
          tripCount: 0,
          serviceFragmentation: 0,
        },
        actions: [],
        signature: '',
      }
      memo.set(key, result)
      return result
    }

    let best: CandidatePlan | null = null
    for (const action of enumerateActions(cursors)) {
      const rest = solve(action.nextCursors)
      if (!rest) continue

      const footprint = buildRegionRouteFootprint({
        activeWorkshop: input.activeWorkshop,
        topology: input.topology,
        servicedRegionIds: action.regionIds,
      })
      const fragmentationIncrement =
        action.regionIds.reduce(
          (sum, regionId) => {
            const regionIndex = regions.indexOf(regionId)
            return (
              sum +
              ((cursors[regionIndex] ?? 0) > 0 ? 1 : 0)
            )
          },
          0,
        )
      const signature = rest.signature
        ? `${action.signature}|${rest.signature}`
        : action.signature
      const candidate: CandidatePlan = {
        score: {
          routeCost:
            footprint.routeCost + rest.score.routeCost,
          tripCount: 1 + rest.score.tripCount,
          serviceFragmentation:
            fragmentationIncrement +
            rest.score.serviceFragmentation,
        },
        actions: [action, ...rest.actions],
        signature,
      }

      if (
        best === null ||
        compareRegionServicePlanScores(
          candidate.score,
          best.score,
        ) < 0 ||
        (
          compareRegionServicePlanScores(
            candidate.score,
            best.score,
          ) === 0 &&
          candidate.signature.localeCompare(best.signature) < 0
        )
      ) {
        best = candidate
      }
    }

    memo.set(key, best)
    return best
  }

  const initialCursors = new Array<number>(
    regions.length,
  ).fill(0)
  const best = solve(initialCursors)
  if (!best) return []

  const preferenceByCustomerId: Record<string, number> = {}
  best.actions.forEach((action, tripIndex) => {
    action.segments.forEach((segment) => {
      segment.customerIds.forEach((customerId) => {
        preferenceByCustomerId[customerId] = tripIndex + 1
      })
    })
  })
  if (
    Object.keys(preferenceByCustomerId).length !==
    input.demand.assignedServings
  ) {
    return []
  }

  const regionServiceIntent =
    buildRegionServiceIntentFromPreference(
      input,
      preferenceByCustomerId,
    )
  if (
    regionServiceIntent.tripCount >
    baselineSalesPlan.trips.length + regions.length
  ) {
    return []
  }

  return [{
    regionServiceIntent,
    preferenceByCustomerId,
  }]
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

  const sharedRegionInput = {
    activeWorkshop: input.activeWorkshop,
    topology: input.topology,
    recipeAssignments: recipeAssignments(input.demand),
    customerRegionById: input.customerRegionById,
    maxCustomerServicesPerTrip:
      abstractPhysicalCapacity,
  }
  const canonicalRegionServiceIntent =
    planRegionServiceTrips(sharedRegionInput)
  const physicalOrderRegionServiceIntent =
    planRegionServiceTrips({
      ...sharedRegionInput,
      regionOrder: baselineRegionOrder(
        baselineSalesPlan,
        input.customerRegionById,
      ),
    })
  const regionServiceIntents = [
    canonicalRegionServiceIntent,
    physicalOrderRegionServiceIntent,
  ].filter((intent, index, all) => {
    const signature = preferenceSignature(intent)
    return (
      all.findIndex(
        (candidate) =>
          preferenceSignature(candidate) === signature,
      ) === index
    )
  })
  const regionPreferenceCandidates = [
    ...regionServiceIntents
      .flatMap((regionServiceIntent) => [
        {
          regionServiceIntent,
          preferenceByCustomerId:
            tripPreferenceByCustomerId(regionServiceIntent),
        },
        {
          regionServiceIntent,
          preferenceByCustomerId:
            segmentPreferenceByCustomerId(
              regionServiceIntent,
              'earliest',
            ),
        },
        {
          regionServiceIntent,
          preferenceByCustomerId:
            segmentPreferenceByCustomerId(
              regionServiceIntent,
              'latest',
            ),
        },
        {
          regionServiceIntent,
          preferenceByCustomerId:
            regionPhasePreferenceByCustomerId(
              regionServiceIntent,
            ),
        },
      ])
      .filter((candidate, index, all) => {
        const signature = customerPreferenceSignature(
          candidate.preferenceByCustomerId,
        )
        return (
          all.findIndex(
            (other) =>
              customerPreferenceSignature(
                other.preferenceByCustomerId,
              ) === signature,
          ) === index
        )
      }),
    ...boundedPhysicalAwareRegionPreferences(
      input,
      baselineSalesPlan,
      abstractPhysicalCapacity,
    ),
  ].filter((candidate, index, all) => {
    const signature = customerPreferenceSignature(
      candidate.preferenceByCustomerId,
    )
    return (
      all.findIndex(
        (other) =>
          customerPreferenceSignature(
            other.preferenceByCustomerId,
          ) === signature,
      ) === index
    )
  })

  const baseline = describePhysicalTrips(
    baselineSalesPlan,
    input.activeWorkshop,
    input.topology,
    input.customerRegionById,
  )
  let selected = {
    salesPlan: baselineSalesPlan,
    realized: baseline,
    regionServiceIntent: canonicalRegionServiceIntent,
  }

  for (const candidate of regionPreferenceCandidates) {
    const {
      regionServiceIntent,
      preferenceByCustomerId,
    } = candidate
    const regionOrderedDemand =
      demandForRegionServicePlan(
        input.demand,
        preferenceByCustomerId,
      )
    let regionSalesPlan: MultiTripReplenishmentPlan
    try {
      regionSalesPlan = buildPhysicalPlan(
        input,
        regionOrderedDemand,
        preferenceByCustomerId,
      )
    } catch (error) {
      if (error instanceof PlanningUserError) {
        continue
      }
      throw error
    }
    const regional = describePhysicalTrips(
      regionSalesPlan,
      input.activeWorkshop,
      input.topology,
      input.customerRegionById,
    )

    if (
      compareRegionServicePlanScores(
        regional.score,
        selected.realized.score,
      ) < 0
    ) {
      selected = {
        salesPlan: regionSalesPlan,
        realized: regional,
        regionServiceIntent,
      }
    }
  }

  return {
    activeWorkshop: { ...input.activeWorkshop },
    regionServiceIntent: selected.regionServiceIntent,
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
