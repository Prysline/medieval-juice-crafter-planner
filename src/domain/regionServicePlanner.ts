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

export function planRegionServiceTrips(
  _input: RegionServicePlannerInput,
): RegionServicePlan {
  throw new Error('Region service planner not implemented')
}
