import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import {
  countFormalCustomersByVillage,
  isFormalCustomer,
} from './customerState'

describe('formal customer state', () => {
  it('counts formal customers per village without cross-village leakage', () => {
    expect(
      countFormalCustomersByVillage(
        customers,
        ['jack', 'nanette', 'peter'],
        'east-harbor',
      ),
    ).toBe(2)

    expect(
      countFormalCustomersByVillage(
        customers,
        ['jack', 'nanette', 'peter'],
        'tranquil-fountain',
      ),
    ).toBe(1)
  })

  it('ignores stale ids that are not current customers', () => {
    expect(
      countFormalCustomersByVillage(
        customers,
        ['jack', 'stale-customer-id'],
        'east-harbor',
      ),
    ).toBe(1)
  })

  it('counts the confirmed east harbor mainline thresholds exactly', () => {
    const eastHarborIds = customers
      .filter((customer) => customer.villageId === 'east-harbor')
      .map((customer) => customer.id)

    expect(eastHarborIds.length).toBeGreaterThanOrEqual(17)
    expect(
      countFormalCustomersByVillage(
        customers,
        eastHarborIds.slice(0, 14),
        'east-harbor',
      ),
    ).toBe(14)
    expect(
      countFormalCustomersByVillage(
        customers,
        eastHarborIds.slice(0, 17),
        'east-harbor',
      ),
    ).toBe(17)
  })

  it('checks formal state independently from supplied state', () => {
    expect(isFormalCustomer('jack', ['jack'])).toBe(true)
    expect(isFormalCustomer('nanette', ['jack'])).toBe(false)
  })
})
