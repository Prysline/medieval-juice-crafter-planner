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

interface RegionPreferenceBeamState {
  tripServings: number[]
  tripRegions: RegionId[][]
  tripBySegment: number[]
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
  const allReusableJarsStartEmpty =
    jarCount > 0 &&
    input.availableJuiceJarInventory.every(
      (jar) =>
        (jar.recipeId === null || jar.servings <= 0) &&
        jar.servings <= 0,
    )
  if (!allReusableJarsStartEmpty) return []

  const segments: RegionPreferenceSegment[] = []
  for (const recipe of input.demand.recipes) {
    const byRegion = new Map<RegionId, string[]>()
    for (const customerId of recipe.customerIds) {
      const regionId = regionForCustomer(
        customerId,
        input.customerRegionById,
      )
      const current = byRegion.get(regionId) ?? []
      current.push(customerId)
      byRegion.set(regionId, current)
    }

    for (const [regionId, customerIds] of byRegion) {
      for (
        let offset = 0;
        offset < customerIds.length;
        offset += capacity
      ) {
        segments.push({
          recipeId: recipe.recipeId,
          regionId,
          customerIds: customerIds.slice(
            offset,
            offset + capacity,
          ),
        })
      }
    }
  }

  const uniqueRegionCount = new Set(
    segments.map((segment) => segment.regionId),
  ).size
  if (
    segments.length === 0 ||
    segments.length > 64 ||
    uniqueRegionCount > 6 ||
    jarCount > 8
  ) {
    return []
  }

  const baselineTripCount = Math.max(
    1,
    baselineSalesPlan.trips.length,
  )
  const maxTripCount = Math.min(
    segments.length,
    baselineTripCount + Math.min(3, uniqueRegionCount),
  )
  const beamWidth = 512
  const finalCandidateLimit = 64
  const recipeIds = [
    ...new Set(segments.map((segment) => segment.recipeId)),
  ]

  const scoreState = (
    state: RegionPreferenceBeamState,
  ): [number, number, number, string] => {
    const routeCost = state.tripRegions.reduce(
      (sum, regionIds) =>
        regionIds.length === 0
          ? sum
          : sum +
            buildRegionRouteFootprint({
              activeWorkshop: input.activeWorkshop,
              topology: input.topology,
              servicedRegionIds: regionIds,
            }).routeCost,
      0,
    )
    const bounds = new Map<
      string,
      { start: number; end: number }
    >()
    state.tripBySegment.forEach((tripIndex, segmentIndex) => {
      const recipeId = segments[segmentIndex]?.recipeId
      if (!recipeId) return
      const current = bounds.get(recipeId)
      if (!current) {
        bounds.set(recipeId, {
          start: tripIndex,
          end: tripIndex,
        })
      } else {
        current.start = Math.min(current.start, tripIndex)
        current.end = Math.max(current.end, tripIndex)
      }
    })
    const windowSpan = [...bounds.values()].reduce(
      (sum, bound) => sum + bound.end - bound.start,
      0,
    )
    const usedTrips = state.tripServings.filter(
      (servings) => servings > 0,
    ).length
    return [
      routeCost,
      windowSpan,
      -usedTrips,
      state.tripBySegment.join(','),
    ]
  }

  const respectsJarWindowBound = (
    state: RegionPreferenceBeamState,
  ): boolean => {
    const bounds = new Map<
      string,
      { start: number; end: number }
    >()
    state.tripBySegment.forEach((tripIndex, segmentIndex) => {
      const recipeId = segments[segmentIndex]?.recipeId
      if (!recipeId) return
      const current = bounds.get(recipeId)
      if (!current) {
        bounds.set(recipeId, {
          start: tripIndex,
          end: tripIndex,
        })
      } else {
        current.start = Math.min(current.start, tripIndex)
        current.end = Math.max(current.end, tripIndex)
      }
    })
    for (let tripIndex = 0; tripIndex < maxTripCount; tripIndex += 1) {
      const overlappingRecipes = recipeIds.filter((recipeId) => {
        const bound = bounds.get(recipeId)
        return (
          bound !== undefined &&
          bound.start <= tripIndex &&
          tripIndex <= bound.end
        )
      }).length
      if (overlappingRecipes > jarCount) return false
    }
    return true
  }

  const candidates: Array<{
    regionServiceIntent: RegionServicePlan
    preferenceByCustomerId: Record<string, number>
  }> = []

  for (
    let targetTripCount = baselineTripCount;
    targetTripCount <= maxTripCount;
    targetTripCount += 1
  ) {
    let beam: RegionPreferenceBeamState[] = [{
      tripServings: new Array<number>(targetTripCount).fill(0),
      tripRegions: Array.from(
        { length: targetTripCount },
        () => [] as RegionId[],
      ),
      tripBySegment: [],
    }]

    for (
      let segmentIndex = 0;
      segmentIndex < segments.length;
      segmentIndex += 1
    ) {
      const segment = segments[segmentIndex]
      const expanded: RegionPreferenceBeamState[] = []
      for (const state of beam) {
        for (
          let tripIndex = 0;
          tripIndex < targetTripCount;
          tripIndex += 1
        ) {
          const nextServings =
            state.tripServings[tripIndex] +
            segment.customerIds.length
          if (nextServings > capacity) continue

          const next: RegionPreferenceBeamState = {
            tripServings: [...state.tripServings],
            tripRegions: state.tripRegions.map(
              (regionIds) => [...regionIds],
            ),
            tripBySegment: [
              ...state.tripBySegment,
              tripIndex,
            ],
          }
          next.tripServings[tripIndex] = nextServings
          if (
            !next.tripRegions[tripIndex].includes(
              segment.regionId,
            )
          ) {
            next.tripRegions[tripIndex].push(
              segment.regionId,
            )
          }
          if (!respectsJarWindowBound(next)) continue

          const remainingSegments =
            segments.length - segmentIndex - 1
          const emptyTrips = next.tripServings.filter(
            (servings) => servings === 0,
          ).length
          if (emptyTrips > remainingSegments) continue
          expanded.push(next)
        }
      }

      expanded.sort((a, b) => {
        const aScore = scoreState(a)
        const bScore = scoreState(b)
        return (
          aScore[0] - bScore[0] ||
          aScore[1] - bScore[1] ||
          aScore[2] - bScore[2] ||
          aScore[3].localeCompare(bScore[3])
        )
      })
      const seen = new Set<string>()
      beam = expanded.filter((state) => {
        const signature = state.tripBySegment.join(',')
        if (seen.has(signature)) return false
        seen.add(signature)
        return true
      }).slice(0, beamWidth)
      if (beam.length === 0) break
    }

    for (const state of beam) {
      if (
        state.tripServings.some((servings) => servings === 0)
      ) {
        continue
      }
      const preferenceByCustomerId: Record<string, number> = {}
      state.tripBySegment.forEach((tripIndex, segmentIndex) => {
        for (const customerId of (
          segments[segmentIndex]?.customerIds ?? []
        )) {
          preferenceByCustomerId[customerId] =
            tripIndex + 1
        }
      })
      if (
        Object.keys(preferenceByCustomerId).length !==
        input.demand.assignedServings
      ) {
        continue
      }
      candidates.push({
        regionServiceIntent:
          buildRegionServiceIntentFromPreference(
            input,
            preferenceByCustomerId,
          ),
        preferenceByCustomerId,
      })
    }
  }

  candidates.sort((a, b) => {
    const scoreComparison = compareRegionServicePlanScores(
      a.regionServiceIntent,
      b.regionServiceIntent,
    )
    return (
      scoreComparison ||
      customerPreferenceSignature(
        a.preferenceByCustomerId,
      ).localeCompare(
        customerPreferenceSignature(
          b.preferenceByCustomerId,
        ),
      )
    )
  })

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const signature = customerPreferenceSignature(
      candidate.preferenceByCustomerId,
    )
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  }).slice(0, finalCandidateLimit)
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
    const regionSalesPlan = buildPhysicalPlan(
      input,
      regionOrderedDemand,
      preferenceByCustomerId,
    )
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
