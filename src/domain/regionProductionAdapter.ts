import { customers } from '../data/customers'
import { villages } from '../data/villages'
import type {
  ProgressMilestoneId,
  VillageId,
} from '../types'
import { villageIsAvailable } from './availability'
import type {
  ActiveWorkshop,
  RegionTopologyEdge,
} from './regionServicePlanner'

const CONFIRMED_PRODUCTION_REGION_EDGES: readonly RegionTopologyEdge[] = [
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
]

export interface ProductionWorkshopOption {
  id: string
  regionId: VillageId
  label: string
}

export interface ProductionRegionRoutingInput {
  activeWorkshop: ActiveWorkshop
  topology: {
    edges: readonly RegionTopologyEdge[]
  }
}

export function availableProductionWorkshopRegions(
  currentProgress: ProgressMilestoneId,
): ProductionWorkshopOption[] {
  return villages
    .filter((region) =>
      villageIsAvailable(region.id, currentProgress),
    )
    .map((region) => ({
      id: `workshop:${region.id}`,
      regionId: region.id,
      label: region.name,
    }))
}

export function productionRegionRoutingInput(
  currentProgress: ProgressMilestoneId,
  activeWorkshopRegionId: VillageId,
): ProductionRegionRoutingInput {
  const available = availableProductionWorkshopRegions(
    currentProgress,
  )
  const active = available.find(
    (workshop) =>
      workshop.regionId === activeWorkshopRegionId,
  )
  if (!active) {
    throw new Error(
      `Active workshop Region ${activeWorkshopRegionId} is not available at the current progress`,
    )
  }

  const availableRegionIds = new Set(
    available.map((workshop) => workshop.regionId),
  )

  return {
    activeWorkshop: {
      id: active.id,
      regionId: active.regionId,
    },
    topology: {
      edges: CONFIRMED_PRODUCTION_REGION_EDGES.filter(
        (edge) =>
          availableRegionIds.has(edge.from as VillageId) &&
          availableRegionIds.has(edge.to as VillageId),
      ),
    },
  }
}

export function productionCustomerRegionById(
  customerIds: readonly string[],
): Record<string, VillageId> {
  const customerById = new Map(
    customers.map((customer) => [
      customer.id,
      customer,
    ]),
  )

  return Object.fromEntries(
    customerIds.map((customerId) => {
      const customer = customerById.get(customerId)
      if (!customer) {
        throw new Error(
          `Unknown production customer ${customerId}`,
        )
      }
      return [customerId, customer.villageId]
    }),
  ) as Record<string, VillageId>
}
