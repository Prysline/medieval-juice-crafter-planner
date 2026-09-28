import type {
  InventoryState,
  PlannerSettings,
  ProgressMilestoneId,
  SatisfactionByVillage,
} from '../types'
import type { OptimizationResult } from './optimizer'
import type { PreparationDemand } from './preparationDemand'
import type { PreparationShortfall } from './preparationShortfall'
import type {
  MultiTripReplenishmentPlan,
} from './multiTripReplenishment'
import {
  buildProductionLogisticsPlan,
  type ProductionLogisticsPlan,
} from './productionLogistics'
import {
  buildPlanApplicationTransactionDraft,
  rebasePlanApplicationTransactionSuppliedCustomers,
  type PlanApplicationTransactionDraft,
} from './planApplicationTransaction'
import {
  buildDeliveryExecutionPlan,
  createDeliveryExecutionCursor,
  type DeliveryExecutionCursor,
  type DeliveryExecutionPlan,
} from './deliveryExecution'
import {
  describeRealizedRegionPhysicalSalesPlan,
  type RegionPhysicalSalesPlan,
} from './regionPhysicalSalesPlanner'
import type {
  ActiveWorkshop,
  RegionId,
  RegionTopologyEdge,
} from './regionServicePlanner'
import {
  cloneCustomSalesTripPlan,
  type CustomSalesTripPlan,
} from './customSalesTripPlan'

export interface AppliedCustomSalesTripPlan {
  planningPlan: CustomSalesTripPlan
  salesPlan: MultiTripReplenishmentPlan
  regionPlan: RegionPhysicalSalesPlan
}

export interface AppliedCustomSalesTripDownstream {
  appliedPlan: AppliedCustomSalesTripPlan
  productionLogistics: ProductionLogisticsPlan
  transactionDraft: PlanApplicationTransactionDraft
  deliveryExecutionPlan: DeliveryExecutionPlan
  deliveryCursor: DeliveryExecutionCursor
}

export type BuildAppliedCustomSalesTripResult =
  | {
      status: 'valid'
      downstream: AppliedCustomSalesTripDownstream
    }
  | {
      status: 'invalid'
      message: string
    }

export interface BuildAppliedCustomSalesTripInput {
  planningPlan: CustomSalesTripPlan
  salesPlan: MultiTripReplenishmentPlan
  demand: PreparationDemand
  result: OptimizationResult
  shortfall: PreparationShortfall
  basis: {
    inventory: InventoryState
    currentProgress: ProgressMilestoneId
    satisfactionByVillage: SatisfactionByVillage
    formalCustomerIds: readonly string[]
    originalSuppliedCustomerIds: readonly string[]
    currentSuppliedCustomerIds: readonly string[]
    plannerSettings: PlannerSettings
  }
  region: {
    activeWorkshop: ActiveWorkshop
    topology: {
      edges: readonly RegionTopologyEdge[]
    }
    customerRegionById: Readonly<Record<string, RegionId>>
  }
}

export function buildAppliedCustomSalesTrip(
  input: BuildAppliedCustomSalesTripInput,
): BuildAppliedCustomSalesTripResult {
  const productionLogistics = buildProductionLogisticsPlan(
    input.shortfall,
    input.basis.inventory,
    input.basis.plannerSettings,
    input.salesPlan.productionJarFills,
  )
  if (!productionLogistics.feasible) {
    return {
      status: 'invalid',
      message:
        '自訂趟次的製作物流目前不可行：' +
        (productionLogistics.issues.join('；') ||
          '請調整趟次後重新驗證。'),
    }
  }

  const baseTransaction =
    buildPlanApplicationTransactionDraft({
      basis: {
        inventory: input.basis.inventory,
        currentProgress: input.basis.currentProgress,
        satisfactionByVillage:
          input.basis.satisfactionByVillage,
        formalCustomerIds: [
          ...input.basis.formalCustomerIds,
        ],
        suppliedCustomerIds: [
          ...input.basis.originalSuppliedCustomerIds,
        ],
        plannerSettings: input.basis.plannerSettings,
      },
      result: input.result,
      preparationShortfall: input.shortfall,
      productionLogistics,
      salesPlan: input.salesPlan,
    })

  const transactionDraft =
    rebasePlanApplicationTransactionSuppliedCustomers(
      baseTransaction,
      input.basis.currentSuppliedCustomerIds,
      input.basis.originalSuppliedCustomerIds,
    )
  if (!transactionDraft) {
    return {
      status: 'invalid',
      message:
        '目前的今日已供應紀錄無法與這份自訂規劃安全對齊；請先修正交付紀錄或重新產生規劃。',
    }
  }

  const deliveryExecutionPlan = buildDeliveryExecutionPlan(
    input.shortfall,
    input.salesPlan,
  )
  const regionPlan =
    describeRealizedRegionPhysicalSalesPlan({
      demand: input.demand,
      salesPlan: input.salesPlan,
      activeWorkshop: input.region.activeWorkshop,
      topology: input.region.topology,
      customerRegionById:
        input.region.customerRegionById,
    })

  return {
    status: 'valid',
    downstream: {
      appliedPlan: {
        planningPlan: cloneCustomSalesTripPlan(
          input.planningPlan,
        ),
        salesPlan: input.salesPlan,
        regionPlan,
      },
      productionLogistics,
      transactionDraft,
      deliveryExecutionPlan,
      deliveryCursor:
        createDeliveryExecutionCursor(
          deliveryExecutionPlan,
        ),
    },
  }
}
