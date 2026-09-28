import { customers } from './data/customers'
import { buildCustomerGameOrder } from './data/customerGameOrder'
import { customerResidenceByCustomerId } from './data/customerResidences'

const naturalPresentationCollator = new Intl.Collator('zh-Hant', {
  numeric: true,
  sensitivity: 'base',
})

const customerGameOrder = buildCustomerGameOrder(customers)

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
