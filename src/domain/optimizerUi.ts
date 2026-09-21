import { formatMoney } from './displayFormat'
import { PROCESSING_STACK_CAPACITY, WATER_STACK_CAPACITY } from './inventoryRules'
import { customerIsUnlocked } from './availability'
import type {
  Customer,
  ProgressMilestoneId,
  SatisfactionByVillage,
} from '../types'

export type OptimizerCustomerScope = 'all' | 'potential' | 'formal'

export function optimizerCustomerIds(
  customers: Customer[],
  currentProgress: ProgressMilestoneId,
  satisfactionByVillage: SatisfactionByVillage,
  suppliedCustomerIds: string[],
  formalCustomerIds: string[],
  scope: OptimizerCustomerScope,
): string[] {
  const supplied = new Set(suppliedCustomerIds)
  const formal = new Set(formalCustomerIds)

  return customers
    .filter((customer) =>
      customerIsUnlocked(
        customer,
        currentProgress,
        satisfactionByVillage,
      ),
    )
    .filter((customer) => !supplied.has(customer.id))
    .filter((customer) => {
      if (scope === 'formal') return formal.has(customer.id)
      if (scope === 'potential') return !formal.has(customer.id)
      return true
    })
    .map((customer) => customer.id)
}


export function optimizerCustomerLabel(
  customer: Pick<Customer, 'name' | 'occupation'>,
): string {
  return `${customer.name}（${customer.occupation}）`
}

export function optimizerMoney(value: number): string {
  return formatMoney(value)
}


export function optimizerWaterFetchSlots(unitsToFetch: number): number {
  if (!Number.isFinite(unitsToFetch) || unitsToFetch <= 0) return 0
  return Math.ceil(Math.floor(unitsToFetch) / WATER_STACK_CAPACITY)
}

export function optimizerOperationQuantities(quantity: number): number[] {
  if (!Number.isFinite(quantity) || quantity <= 0) return []
  const wholeQuantity = Math.floor(quantity)
  const operationCount = Math.ceil(
    wholeQuantity / PROCESSING_STACK_CAPACITY,
  )
  return Array.from({ length: operationCount }, (_, index) =>
    Math.min(
      PROCESSING_STACK_CAPACITY,
      wholeQuantity - index * PROCESSING_STACK_CAPACITY,
    ),
  )
}
