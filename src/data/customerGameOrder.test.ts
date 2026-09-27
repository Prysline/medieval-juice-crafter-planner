import { describe, expect, it } from 'vitest'
import {
  buildCustomerGameOrder,
  eastHarborCustomerGameOrder,
  ibexStatueCustomerGameOrder,
  tranquilFountainCustomerGameOrder,
} from './customerGameOrder'
import { customers } from './customers'

describe('observed customer game order', () => {
  const observedOrders = [
    {
      villageId: 'east-harbor',
      order: eastHarborCustomerGameOrder,
      count: 29,
    },
    {
      villageId: 'tranquil-fountain',
      order: tranquilFountainCustomerGameOrder,
      count: 23,
    },
    {
      villageId: 'ibex-statue',
      order: ibexStatueCustomerGameOrder,
      count: 21,
    },
  ] as const

  for (const observation of observedOrders) {
    it(`covers every ${observation.villageId} customer exactly once in the observed order`, () => {
      const villageIds = customers
        .filter(
          (customer) =>
            customer.villageId === observation.villageId,
        )
        .map((customer) => customer.id)

      expect(observation.order).toHaveLength(observation.count)
      expect(new Set(observation.order).size).toBe(observation.count)
      expect([...observation.order].sort()).toEqual(
        [...villageIds].sort(),
      )
    })
  }

  it('applies the observed game order independently inside all three villages', () => {
    const order = buildCustomerGameOrder(customers)
    const sorted = [...customers].sort(
      (left, right) =>
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    )

    for (const observation of observedOrders) {
      expect(
        sorted
          .filter(
            (customer) =>
              customer.villageId === observation.villageId,
          )
          .map((customer) => customer.id),
      ).toEqual([...observation.order])
    }
  })
})
