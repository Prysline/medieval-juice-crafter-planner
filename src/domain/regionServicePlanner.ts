export type RegionId = string

export interface RegionTopologyEdge {
  from: RegionId
  to: RegionId
  cost: number
}

export interface ActiveWorkshop {
  id: string
  regionId: RegionId
}

export interface RegionRecipeAssignment {
  recipeId: string
  customerIds: readonly string[]
}

export interface RegionServiceCustomerAssignment {
  customerId: string
  recipeId: string
  regionId: RegionId
}

export interface RegionRouteFootprintEdge {
  from: RegionId
  to: RegionId
  cost: number
  traversalCount: 2
}

export interface RegionTripService {
  regionId: RegionId
  role: 'primary' | 'side'
  customerAssignments: RegionServiceCustomerAssignment[]
}

export interface RegionServiceTrip {
  tripNumber: number
  services: RegionTripService[]
  servicedRegionIds: RegionId[]
  primaryRegionIds: RegionId[]
  sideRegionIds: RegionId[]
  transitRegionIds: RegionId[]
  routeFootprint: RegionRouteFootprintEdge[]
  routeCost: number
}

export interface RegionServicePlanScore {
  routeCost: number
  tripCount: number
  serviceFragmentation: number
}

export interface RegionServicePlan extends RegionServicePlanScore {
  activeWorkshop: ActiveWorkshop
  customerAssignments: RegionServiceCustomerAssignment[]
  trips: RegionServiceTrip[]
}

export interface RegionServicePlannerInput {
  activeWorkshop: ActiveWorkshop
  topology: {
    edges: readonly RegionTopologyEdge[]
  }
  recipeAssignments: readonly RegionRecipeAssignment[]
  customerRegionById: Readonly<Record<string, RegionId>>
  /**
   * P1-B 的純 domain 容量，只限制一趟最多可服務幾位顧客。
   * P1-C 才由 physical jar / cup scheduler 提供真實可行性；本層不重做實體物流。
   */
  maxCustomerServicesPerTrip: number
}

interface CanonicalGraphEdge {
  from: RegionId
  to: RegionId
  cost: number
  key: string
}

interface GraphNeighbor {
  regionId: RegionId
  edge: CanonicalGraphEdge
}

interface RegionGraph {
  neighborsByRegion: Map<RegionId, GraphNeighbor[]>
}

interface ShortestPath {
  nodes: RegionId[]
  edges: CanonicalGraphEdge[]
  cost: number
}

interface RouteFootprint {
  routeCost: number
  edges: RegionRouteFootprintEdge[]
  primaryRegionIds: RegionId[]
  sideRegionIds: RegionId[]
  transitRegionIds: RegionId[]
}

interface TripPattern {
  servingsByRegion: number[]
}

interface PatternPlan {
  score: RegionServicePlanScore
  patterns: TripPattern[]
  signature: string
}

const PATH_SEPARATOR = '\u001f'

function canonicalEdgeKey(a: RegionId, b: RegionId): string {
  return a.localeCompare(b) <= 0
    ? `${a}${PATH_SEPARATOR}${b}`
    : `${b}${PATH_SEPARATOR}${a}`
}

function canonicalEdge(
  edge: RegionTopologyEdge,
): CanonicalGraphEdge {
  const [from, to] =
    edge.from.localeCompare(edge.to) <= 0
      ? [edge.from, edge.to]
      : [edge.to, edge.from]

  return {
    from,
    to,
    cost: edge.cost,
    key: canonicalEdgeKey(from, to),
  }
}

function buildRegionGraph(
  edges: readonly RegionTopologyEdge[],
): RegionGraph {
  const neighborsByRegion = new Map<RegionId, GraphNeighbor[]>()
  const edgeByKey = new Map<string, CanonicalGraphEdge>()

  const addNeighbor = (
    from: RegionId,
    to: RegionId,
    edge: CanonicalGraphEdge,
  ): void => {
    const neighbors = neighborsByRegion.get(from) ?? []
    neighbors.push({ regionId: to, edge })
    neighborsByRegion.set(from, neighbors)
  }

  for (const rawEdge of edges) {
    if (!rawEdge.from || !rawEdge.to) {
      throw new Error('Region topology edges require two Region IDs')
    }
    if (rawEdge.from === rawEdge.to) {
      throw new Error(
        `Region topology cannot contain self-edge ${rawEdge.from}`,
      )
    }
    if (!Number.isFinite(rawEdge.cost) || rawEdge.cost <= 0) {
      throw new Error(
        `Region topology edge ${rawEdge.from} -> ${rawEdge.to} requires a positive finite cost`,
      )
    }

    const edge = canonicalEdge(rawEdge)
    if (edgeByKey.has(edge.key)) {
      throw new Error(
        `Region topology contains duplicate edge ${edge.from} <-> ${edge.to}`,
      )
    }

    edgeByKey.set(edge.key, edge)
    addNeighbor(edge.from, edge.to, edge)
    addNeighbor(edge.to, edge.from, edge)
  }

  for (const neighbors of neighborsByRegion.values()) {
    neighbors.sort(
      (a, b) =>
        a.regionId.localeCompare(b.regionId) ||
        a.edge.cost - b.edge.cost,
    )
  }

  return { neighborsByRegion }
}

function shortestPath(
  graph: RegionGraph,
  start: RegionId,
  target: RegionId,
): ShortestPath {
  if (start === target) {
    return { nodes: [start], edges: [], cost: 0 }
  }

  type QueueItem = {
    regionId: RegionId
    cost: number
    nodes: RegionId[]
    edges: CanonicalGraphEdge[]
    signature: string
  }

  const queue: QueueItem[] = [{
    regionId: start,
    cost: 0,
    nodes: [start],
    edges: [],
    signature: start,
  }]
  const bestByRegion = new Map<
    RegionId,
    { cost: number; signature: string }
  >([
    [start, { cost: 0, signature: start }],
  ])

  while (queue.length > 0) {
    queue.sort(
      (a, b) =>
        a.cost - b.cost ||
        a.signature.localeCompare(b.signature),
    )
    const current = queue.shift()
    if (!current) break

    const best = bestByRegion.get(current.regionId)
    if (
      !best ||
      current.cost !== best.cost ||
      current.signature !== best.signature
    ) {
      continue
    }

    if (current.regionId === target) {
      return {
        nodes: current.nodes,
        edges: current.edges,
        cost: current.cost,
      }
    }

    for (const neighbor of (
      graph.neighborsByRegion.get(current.regionId) ?? []
    )) {
      const nextCost = current.cost + neighbor.edge.cost
      const nextNodes = [...current.nodes, neighbor.regionId]
      const nextSignature = nextNodes.join(PATH_SEPARATOR)
      const previous = bestByRegion.get(neighbor.regionId)

      if (
        previous &&
        (
          previous.cost < nextCost ||
          (
            previous.cost === nextCost &&
            previous.signature.localeCompare(nextSignature) <= 0
          )
        )
      ) {
        continue
      }

      bestByRegion.set(neighbor.regionId, {
        cost: nextCost,
        signature: nextSignature,
      })
      queue.push({
        regionId: neighbor.regionId,
        cost: nextCost,
        nodes: nextNodes,
        edges: [...current.edges, neighbor.edge],
        signature: nextSignature,
      })
    }
  }

  throw new Error(
    `Region ${target} is unreachable from active workshop Region ${start}`,
  )
}

function buildRouteFootprint(
  graph: RegionGraph,
  workshopRegionId: RegionId,
  servicedRegionIds: readonly RegionId[],
): RouteFootprint {
  const uniqueServicedRegionIds = [...new Set(servicedRegionIds)].sort()
  const servicedSet = new Set(uniqueServicedRegionIds)
  const pathByRegion = new Map<RegionId, ShortestPath>()
  const edgeByKey = new Map<string, CanonicalGraphEdge>()
  const pathNodes = new Set<RegionId>()

  for (const regionId of uniqueServicedRegionIds) {
    const path = shortestPath(graph, workshopRegionId, regionId)
    pathByRegion.set(regionId, path)
    path.nodes.forEach((node) => pathNodes.add(node))
    path.edges.forEach((edge) => edgeByKey.set(edge.key, edge))
  }

  const sideRegionIds = uniqueServicedRegionIds.filter(
    (candidate) =>
      uniqueServicedRegionIds.some((target) => {
        if (candidate === target) return false
        return pathByRegion.get(target)?.nodes.includes(candidate) ?? false
      }),
  )
  const sideSet = new Set(sideRegionIds)
  const primaryRegionIds = uniqueServicedRegionIds.filter(
    (regionId) => !sideSet.has(regionId),
  )
  const transitRegionIds = [...pathNodes]
    .filter(
      (regionId) =>
        regionId !== workshopRegionId &&
        !servicedSet.has(regionId),
    )
    .sort()

  const footprintEdges = [...edgeByKey.values()].sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to),
  )
  const routeCost =
    footprintEdges.reduce((sum, edge) => sum + edge.cost, 0) * 2

  return {
    routeCost,
    edges: footprintEdges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      cost: edge.cost,
      traversalCount: 2 as const,
    })),
    primaryRegionIds,
    sideRegionIds,
    transitRegionIds,
  }
}

export function compareRegionServicePlanScores(
  a: RegionServicePlanScore,
  b: RegionServicePlanScore,
): number {
  return (
    a.routeCost - b.routeCost ||
    a.tripCount - b.tripCount ||
    a.serviceFragmentation - b.serviceFragmentation
  )
}

function patternSignature(
  regions: readonly RegionId[],
  pattern: TripPattern,
): string {
  return pattern.servingsByRegion
    .flatMap((count, index) =>
      count > 0 ? [`${regions[index]}:${count}`] : [],
    )
    .join('+')
}

function enumerateFullTripPatterns(
  remaining: readonly number[],
  capacity: number,
): TripPattern[] {
  const totalRemaining = remaining.reduce(
    (sum, value) => sum + value,
    0,
  )
  const target = Math.min(capacity, totalRemaining)
  const result: TripPattern[] = []
  const current = new Array<number>(remaining.length).fill(0)

  const visit = (index: number, slotsLeft: number): void => {
    if (index === remaining.length) {
      if (slotsLeft === 0) {
        result.push({ servingsByRegion: [...current] })
      }
      return
    }

    const availableAfter = remaining
      .slice(index + 1)
      .reduce((sum, value) => sum + value, 0)
    const minimumHere = Math.max(0, slotsLeft - availableAfter)
    const maximumHere = Math.min(remaining[index], slotsLeft)

    for (
      let count = maximumHere;
      count >= minimumHere;
      count -= 1
    ) {
      current[index] = count
      visit(index + 1, slotsLeft - count)
    }
    current[index] = 0
  }

  visit(0, target)
  return result
}

function comparePatternPlans(
  a: PatternPlan,
  b: PatternPlan,
): number {
  return (
    compareRegionServicePlanScores(a.score, b.score) ||
    a.signature.localeCompare(b.signature)
  )
}

function planTripPatterns(
  graph: RegionGraph,
  workshopRegionId: RegionId,
  regions: readonly RegionId[],
  initialCounts: readonly number[],
  capacity: number,
): PatternPlan {
  const memo = new Map<string, PatternPlan>()

  const solve = (remaining: readonly number[]): PatternPlan => {
    const stateKey = remaining.join(',')
    const memoized = memo.get(stateKey)
    if (memoized) return memoized

    const totalRemaining = remaining.reduce(
      (sum, value) => sum + value,
      0,
    )
    if (totalRemaining === 0) {
      const empty: PatternPlan = {
        score: {
          routeCost: 0,
          tripCount: 0,
          serviceFragmentation: 0,
        },
        patterns: [],
        signature: '',
      }
      memo.set(stateKey, empty)
      return empty
    }

    let best: PatternPlan | null = null

    for (const pattern of enumerateFullTripPatterns(
      remaining,
      capacity,
    )) {
      const servicedRegionIds = pattern.servingsByRegion
        .flatMap((count, index) =>
          count > 0 ? [regions[index]] : [],
        )
      if (servicedRegionIds.length === 0) continue

      const footprint = buildRouteFootprint(
        graph,
        workshopRegionId,
        servicedRegionIds,
      )
      const nextRemaining = remaining.map(
        (count, index) =>
          count - pattern.servingsByRegion[index],
      )
      const fragmentationIncrement =
        pattern.servingsByRegion.reduce(
          (sum, count, index) =>
            sum +
            (
              count > 0 &&
              remaining[index] < initialCounts[index]
                ? 1
                : 0
            ),
          0,
        )
      const rest = solve(nextRemaining)
      const currentSignature = patternSignature(
        regions,
        pattern,
      )
      const candidate: PatternPlan = {
        score: {
          routeCost:
            footprint.routeCost + rest.score.routeCost,
          tripCount: 1 + rest.score.tripCount,
          serviceFragmentation:
            fragmentationIncrement +
            rest.score.serviceFragmentation,
        },
        patterns: [pattern, ...rest.patterns],
        signature: rest.signature
          ? `${currentSignature}|${rest.signature}`
          : currentSignature,
      }

      if (
        best === null ||
        comparePatternPlans(candidate, best) < 0
      ) {
        best = candidate
      }
    }

    if (!best) {
      throw new Error(
        'Region service planner could not build a trip pattern',
      )
    }

    memo.set(stateKey, best)
    return best
  }

  return solve(initialCounts)
}

function normalizeCustomerAssignments(
  recipeAssignments: readonly RegionRecipeAssignment[],
  customerRegionById: Readonly<Record<string, RegionId>>,
): RegionServiceCustomerAssignment[] {
  const seenCustomerIds = new Set<string>()
  const assignments: RegionServiceCustomerAssignment[] = []

  for (const recipe of recipeAssignments) {
    if (!recipe.recipeId) {
      throw new Error('Region service assignment requires recipeId')
    }

    for (const customerId of recipe.customerIds) {
      if (seenCustomerIds.has(customerId)) {
        throw new Error(
          `Customer ${customerId} appears in more than one recipe assignment`,
        )
      }
      seenCustomerIds.add(customerId)

      const regionId = customerRegionById[customerId]
      if (!regionId) {
        throw new Error(
          `Missing Region identity for customer ${customerId}`,
        )
      }

      assignments.push({
        customerId,
        recipeId: recipe.recipeId,
        regionId,
      })
    }
  }

  return assignments
}

export function planRegionServiceTrips(
  input: RegionServicePlannerInput,
): RegionServicePlan {
  if (
    !Number.isInteger(input.maxCustomerServicesPerTrip) ||
    input.maxCustomerServicesPerTrip <= 0
  ) {
    throw new Error(
      'Region service planner requires a positive integer trip service capacity',
    )
  }
  if (!input.activeWorkshop.id) {
    throw new Error('Region service planner requires an active workshop ID')
  }
  if (!input.activeWorkshop.regionId) {
    throw new Error(
      'Region service planner requires an active workshop Region',
    )
  }

  const customerAssignments = normalizeCustomerAssignments(
    input.recipeAssignments,
    input.customerRegionById,
  )

  if (customerAssignments.length === 0) {
    return {
      activeWorkshop: { ...input.activeWorkshop },
      customerAssignments: [],
      trips: [],
      routeCost: 0,
      tripCount: 0,
      serviceFragmentation: 0,
    }
  }

  const graph = buildRegionGraph(input.topology.edges)
  const assignmentsByRegion = new Map<
    RegionId,
    RegionServiceCustomerAssignment[]
  >()
  for (const assignment of customerAssignments) {
    const current =
      assignmentsByRegion.get(assignment.regionId) ?? []
    current.push(assignment)
    assignmentsByRegion.set(assignment.regionId, current)
  }

  const regions = [...assignmentsByRegion.keys()].sort()
  const initialCounts = regions.map(
    (regionId) =>
      assignmentsByRegion.get(regionId)?.length ?? 0,
  )

  // Validate reachability once before the combinatorial packing step so
  // topology errors remain clear domain errors rather than candidate failures.
  for (const regionId of regions) {
    shortestPath(
      graph,
      input.activeWorkshop.regionId,
      regionId,
    )
  }

  const patternPlan = planTripPatterns(
    graph,
    input.activeWorkshop.regionId,
    regions,
    initialCounts,
    input.maxCustomerServicesPerTrip,
  )
  const cursorByRegion = new Map<RegionId, number>(
    regions.map((regionId) => [regionId, 0]),
  )

  const trips = patternPlan.patterns.map(
    (pattern, tripIndex): RegionServiceTrip => {
      const servicedRegionIds = pattern.servingsByRegion
        .flatMap((count, index) =>
          count > 0 ? [regions[index]] : [],
        )
      const footprint = buildRouteFootprint(
        graph,
        input.activeWorkshop.regionId,
        servicedRegionIds,
      )
      const primarySet = new Set(
        footprint.primaryRegionIds,
      )

      const services = servicedRegionIds.map(
        (regionId): RegionTripService => {
          const allAssignments =
            assignmentsByRegion.get(regionId) ?? []
          const cursor = cursorByRegion.get(regionId) ?? 0
          const regionIndex = regions.indexOf(regionId)
          const serviceCount =
            pattern.servingsByRegion[regionIndex]
          const selected = allAssignments.slice(
            cursor,
            cursor + serviceCount,
          )

          if (selected.length !== serviceCount) {
            throw new Error(
              `Region service allocation drifted for ${regionId}`,
            )
          }

          cursorByRegion.set(
            regionId,
            cursor + serviceCount,
          )

          return {
            regionId,
            role: primarySet.has(regionId)
              ? 'primary'
              : 'side',
            customerAssignments: selected,
          }
        },
      )

      return {
        tripNumber: tripIndex + 1,
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

  for (const regionId of regions) {
    const expected =
      assignmentsByRegion.get(regionId)?.length ?? 0
    const consumed = cursorByRegion.get(regionId) ?? 0
    if (consumed !== expected) {
      throw new Error(
        `Region service plan did not allocate every customer in ${regionId}`,
      )
    }
  }

  return {
    activeWorkshop: { ...input.activeWorkshop },
    customerAssignments,
    trips,
    routeCost: patternPlan.score.routeCost,
    tripCount: patternPlan.score.tripCount,
    serviceFragmentation:
      patternPlan.score.serviceFragmentation,
  }
}
