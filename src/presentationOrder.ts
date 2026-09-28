import { customers } from './data/customers'
import { buildCustomerGameOrder } from './data/customerGameOrder'
import {
  customerResidenceByCustomerId,
  customerResidences,
} from './data/customerResidences'

const naturalPresentationCollator = new Intl.Collator('zh-Hant', {
  numeric: true,
  sensitivity: 'base',
})

const customerGameOrder = buildCustomerGameOrder(customers)
const customerResidenceNumberById = new Map(
  customerResidences.map((residence) => [residence.id, residence.number]),
)

export function compareNaturalPresentationId(
  left: string,
  right: string,
): number {
  return naturalPresentationCollator.compare(left, right)
}

export function sortedByNaturalPresentationId<T>(
  items: readonly T[],
  idOf: (item: T) => string,
): T[] {
  return [...items].sort((left, right) =>
    compareNaturalPresentationId(idOf(left), idOf(right)),
  )
}

/**
 * Reorders only the slots occupied by the same confirmed residence.
 * Customers from different residences keep their relative presentation slots,
 * so this cannot invent route or stop ordering.
 */
export function customerIdsInCanonicalResidenceOrder(
  customerIds: readonly string[],
  residenceByCustomerId: Readonly<
    Record<string, string | null | undefined>
  > = customerResidenceByCustomerId,
): string[] {
  const result = [...customerIds]
  const indicesByResidence = new Map<string, number[]>()

  customerIds.forEach((customerId, index) => {
    const residenceId = residenceByCustomerId[customerId]
    if (!residenceId) return
    const indices = indicesByResidence.get(residenceId) ?? []
    indices.push(index)
    indicesByResidence.set(residenceId, indices)
  })

  for (const indices of indicesByResidence.values()) {
    if (indices.length < 2) continue
    const orderedCustomerIds = indices
      .map((index) => customerIds[index]!)
      .sort(
        (left, right) =>
          (customerGameOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
            (customerGameOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
          left.localeCompare(right),
      )

    indices.forEach((index, orderedIndex) => {
      result[index] = orderedCustomerIds[orderedIndex]!
    })
  }

  return result
}


export interface CustomerResidencePresentationGroup {
  residenceId: string | null
  customerIds: string[]
}

/**
 * Groups customers only after the caller has already fixed recipe / Region
 * boundaries. Confirmed residence groups follow the first appearance of that
 * residence in the input; unknown residences remain separate customers so the
 * UI never invents a shared home.
 */
export function customerResidencePresentationGroups(
  customerIds: readonly string[],
  residenceByCustomerId: Readonly<
    Record<string, string | null | undefined>
  > = customerResidenceByCustomerId,
): CustomerResidencePresentationGroup[] {
  const groups: CustomerResidencePresentationGroup[] = []
  const groupIndexByKey = new Map<string, number>()

  for (const customerId of customerIds) {
    const residenceId = residenceByCustomerId[customerId] ?? null
    const groupKey = residenceId
      ? 'residence:' + residenceId
      : 'customer:' + customerId
    const existingIndex = groupIndexByKey.get(groupKey)

    if (existingIndex === undefined) {
      groupIndexByKey.set(groupKey, groups.length)
      groups.push({
        residenceId,
        customerIds: [customerId],
      })
      continue
    }

    groups[existingIndex]!.customerIds.push(customerId)
  }

  return groups.map((group) => ({
    residenceId: group.residenceId,
    customerIds: customerIdsInCanonicalResidenceOrder(
      group.customerIds,
      residenceByCustomerId,
    ),
  }))
}

export function customerResidencePresentationLabel(
  residenceId: string | null | undefined,
): string | null {
  if (!residenceId) return null
  const number = customerResidenceNumberById.get(residenceId)
  return number === undefined
    ? residenceId
    : '住處 ' + number
}
