import { describe, expect, it } from 'vitest'
import {
  buildCustomerGameOrder,
  eastHarborCustomerGameOrder,
} from './customerGameOrder'
import { customers } from './customers'

describe('observed customer game order', () => {
  it('covers every East Harbor customer exactly once in the observed order', () => {
    const eastHarborIds = customers
      .filter((customer) => customer.villageId === 'east-harbor')
      .map((customer) => customer.id)

    expect(eastHarborCustomerGameOrder).toHaveLength(29)
    expect(new Set(eastHarborCustomerGameOrder).size).toBe(29)
    expect([...eastHarborCustomerGameOrder].sort()).toEqual(
      [...eastHarborIds].sort(),
    )
  })

  it('reorders only East Harbor while preserving the source order of other villages', () => {
    const order = buildCustomerGameOrder(customers)
    const sorted = [...customers].sort(
      (left, right) =>
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    )

    expect(
      sorted
        .filter((customer) => customer.villageId === 'east-harbor')
        .map((customer) => customer.id),
    ).toEqual([...eastHarborCustomerGameOrder])

    for (const villageId of ['tranquil-fountain', 'ibex-statue'] as const) {
      expect(
        sorted
          .filter((customer) => customer.villageId === villageId)
          .map((customer) => customer.id),
      ).toEqual(
        customers
          .filter((customer) => customer.villageId === villageId)
          .map((customer) => customer.id),
      )
    }
  })
})
