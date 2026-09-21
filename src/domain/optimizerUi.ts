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
  return `${value} 金幣`
}
