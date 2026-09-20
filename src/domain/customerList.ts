import type { Customer } from '../types'

export type SortDirection = 'asc' | 'desc'
export type CustomerSortKey = 'name' | 'bestMatch' | 'bestPrice'

export interface CustomerListMatch {
  id: string
  name: string
  salePrice: number | null
}

export interface CustomerListRow<
  TMatch extends CustomerListMatch = CustomerListMatch,
> {
  customer: Customer
  unlocked: boolean
  matches: TMatch[]
}

export function filterSuppliedCustomerRows<
  TMatch extends CustomerListMatch,
>(
  rows: CustomerListRow<TMatch>[],
  suppliedCustomerIds: string[],
  showSuppliedToday: boolean,
): CustomerListRow<TMatch>[] {
  if (showSuppliedToday) return rows

  const supplied = new Set(suppliedCustomerIds)
  return rows.filter(({ customer }) => !supplied.has(customer.id))
}

export function sortCustomerRows<
  TMatch extends CustomerListMatch,
>(
  rows: CustomerListRow<TMatch>[],
  sortKey: CustomerSortKey,
  sortDirection: SortDirection,
  recipeOrder: Map<string, number>,
): CustomerListRow<TMatch>[] {
  const direction = sortDirection === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    const aBest = a.matches[0]
    const bBest = b.matches[0]

    if (sortKey === 'bestMatch') {
      if (!aBest && !bBest) {
        return a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
      }
      if (!aBest) return 1
      if (!bBest) return -1

      const orderDelta =
        (recipeOrder.get(aBest.id) ?? Number.MAX_SAFE_INTEGER) -
        (recipeOrder.get(bBest.id) ?? Number.MAX_SAFE_INTEGER)

      return (
        orderDelta * direction ||
        a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
      )
    }

    if (sortKey === 'bestPrice') {
      if (!aBest && !bBest) {
        return a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
      }
      if (!aBest) return 1
      if (!bBest) return -1

      if (aBest.salePrice === null && bBest.salePrice === null) {
        return (
          ((recipeOrder.get(aBest.id) ?? 0) -
            (recipeOrder.get(bBest.id) ?? 0)) *
            direction ||
          a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
        )
      }
      if (aBest.salePrice === null) return 1
      if (bBest.salePrice === null) return -1

      return (
        (aBest.salePrice - bBest.salePrice) * direction ||
        (recipeOrder.get(aBest.id) ?? 0) - (recipeOrder.get(bBest.id) ?? 0) ||
        a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
      )
    }

    return a.customer.name.localeCompare(b.customer.name, 'zh-Hant') * direction
  })
}
