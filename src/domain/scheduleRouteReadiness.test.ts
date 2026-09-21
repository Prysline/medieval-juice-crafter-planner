import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import {
  buildCustomerScheduleReadiness,
  buildRoutePlanningReadiness,
  parseApproxTime,
} from './scheduleRouteReadiness'

describe('schedule normalization and route readiness', () => {
  it('parses exact and approximate-range times without changing raw text', () => {
    expect(parseApproxTime('08:30')).toEqual({
      kind: 'point',
      raw: '08:30',
      minutesSinceMidnight: 510,
    })
    expect(parseApproxTime('08:10～08:19')).toEqual({
      kind: 'range',
      raw: '08:10～08:19',
      startMinutesSinceMidnight: 490,
      endMinutesSinceMidnight: 499,
    })
  })

  it('preserves unsupported time text instead of inventing a numeric value', () => {
    expect(parseApproxTime('待確認')).toEqual({
      kind: 'unparsed',
      raw: '待確認',
    })
  })

  it('does not treat leaving home as the actual village-availability boundary', () => {
    const jack = customers.find((customer) => customer.id === 'jack')
    expect(jack).toBeDefined()
    if (!jack) return

    const readiness = buildCustomerScheduleReadiness(jack)

    expect(readiness.observations[0]).toMatchObject({
      type: 'leave_home',
      meaning: 'leave-home-only',
      describesVillagePresence: false,
    })
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        'leave-home-not-village-boundary',
        'return-time-unknown',
        'service-window-not-established',
      ]),
    )
    expect(readiness.hasCompleteServiceWindow).toBe(false)
  })

  it('keeps outside-village-by and return observations distinct for Ivo', () => {
    const ivo = customers.find((customer) => customer.id === 'ivo')
    expect(ivo).toBeDefined()
    if (!ivo) return

    const readiness = buildCustomerScheduleReadiness(ivo)

    expect(readiness.observations).toEqual([
      expect.objectContaining({
        type: 'outside_village_by',
        meaning: 'outside-village-by',
        describesVillagePresence: true,
      }),
      expect.objectContaining({
        type: 'return_village',
        meaning: 'return-village',
        describesVillagePresence: true,
      }),
    ])
    expect(readiness.blockers).toContain(
      'outside-village-departure-time-unknown',
    )
    expect(readiness.blockers).toContain(
      'service-window-not-established',
    )
    expect(readiness.hasCompleteServiceWindow).toBe(false)
  })

  it('marks customers without schedule observations as unknown rather than always available', () => {
    const peter = customers.find((customer) => customer.id === 'peter')
    expect(peter).toBeDefined()
    if (!peter) return

    const readiness = buildCustomerScheduleReadiness(peter)

    expect(readiness.hasObservedSchedule).toBe(false)
    expect(readiness.observations).toEqual([])
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        'no-schedule-observation',
        'service-window-not-established',
      ]),
    )
  })

  it('reports canonical route optimization as blocked by missing source data', () => {
    const readiness = buildRoutePlanningReadiness()

    expect(readiness.readyForRouteOptimization).toBe(false)
    expect(readiness.customersWithScheduleIds.sort()).toEqual(
      ['ivo', 'jack', 'nanette'].sort(),
    )
    expect(readiness.scheduleCoverage).toEqual({
      observedCustomers: 3,
      totalCustomers: customers.length,
    })
    expect(readiness.blockers).toEqual([
      'missing-cross-village-travel-time',
      'missing-location-identity',
      'incomplete-customer-service-windows',
      'missing-shop-hours',
    ])
  })
})
