import { describe, expect, it } from 'vitest'
import { customers } from './customers'
import {
  customerResidenceByCustomerId,
  customerResidences,
} from './customerResidences'

describe('customer residence data', () => {
  it('maps every canonical customer to exactly one confirmed home residence', () => {
    const assignedCustomerIds = customerResidences.flatMap(
      (residence) => residence.customerIds,
    )
    const canonicalCustomerIds = customers.map(
      (customer) => customer.id,
    )

    expect(assignedCustomerIds).toHaveLength(
      canonicalCustomerIds.length,
    )
    expect(new Set(assignedCustomerIds).size).toBe(
      canonicalCustomerIds.length,
    )
    expect([...assignedCustomerIds].sort()).toEqual(
      [...canonicalCustomerIds].sort(),
    )
    expect(
      Object.keys(customerResidenceByCustomerId).sort(),
    ).toEqual([...canonicalCustomerIds].sort())
  })

  it('keeps every residence in the same Region as its residents', () => {
    const customerById = new Map(
      customers.map((customer) => [customer.id, customer]),
    )

    for (const residence of customerResidences) {
      for (const customerId of residence.customerIds) {
        expect(customerById.get(customerId)?.villageId).toBe(
          residence.villageId,
        )
      }
    }
  })

  it('preserves the confirmed residence counts for all three current Regions', () => {
    expect(
      customerResidences.filter(
        (residence) => residence.villageId === 'east-harbor',
      ),
    ).toHaveLength(9)
    expect(
      customerResidences.filter(
        (residence) =>
          residence.villageId === 'tranquil-fountain',
      ),
    ).toHaveLength(6)
    expect(
      customerResidences.filter(
        (residence) => residence.villageId === 'ibex-statue',
      ),
    ).toHaveLength(8)
  })

  it('uses the corrected East Harbor residence 8 canonical customer identity', () => {
    expect(
      customerResidences.find(
        (residence) =>
          residence.id === 'east-harbor-residence-8',
      )?.customerIds,
    ).toEqual(['harry', 'lizzie', 'zenobia'])
  })
})
