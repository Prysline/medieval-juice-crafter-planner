import type { Customer, VillageId } from '../types'

export function countFormalCustomersByVillage(
  customers: Customer[],
  formalCustomerIds: string[],
  villageId: VillageId,
): number {
  const formalIds = new Set(formalCustomerIds)
  return customers.filter(
    (customer) =>
      customer.villageId === villageId && formalIds.has(customer.id),
  ).length
}

export function isFormalCustomer(
  customerId: string,
  formalCustomerIds: string[],
): boolean {
  return formalCustomerIds.includes(customerId)
}
