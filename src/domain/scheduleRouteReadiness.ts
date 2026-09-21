import { customers as canonicalCustomers } from '../data/customers'
import type {
  Customer,
  ScheduleObservation,
  VillageId,
} from '../types'

export type ParsedApproxTime =
  | {
      kind: 'point'
      raw: string
      minutesSinceMidnight: number
    }
  | {
      kind: 'range'
      raw: string
      startMinutesSinceMidnight: number
      endMinutesSinceMidnight: number
    }
  | {
      kind: 'unparsed'
      raw: string
    }

export type ScheduleObservationMeaning =
  | 'leave-home-only'
  | 'outside-village-by'
  | 'return-village'

export interface NormalizedScheduleObservation {
  type: ScheduleObservation['type']
  approxTime: ParsedApproxTime
  note?: string
  meaning: ScheduleObservationMeaning
  /**
   * true only when the source directly describes village presence.
   * leave_home stays false because source notes distinguish leaving home
   * from actually leaving the village.
   */
  describesVillagePresence: boolean
}

export type CustomerScheduleBlocker =
  | 'no-schedule-observation'
  | 'leave-home-not-village-boundary'
  | 'outside-village-departure-time-unknown'
  | 'return-time-unknown'
  | 'service-window-not-established'

export interface CustomerScheduleReadiness {
  customerId: string
  customerName: string
  villageId: VillageId
  observations: NormalizedScheduleObservation[]
  blockers: CustomerScheduleBlocker[]
  hasObservedSchedule: boolean
  hasCompleteServiceWindow: false
}

export type RoutePlanningBlocker =
  | 'missing-cross-village-travel-time'
  | 'missing-location-identity'
  | 'incomplete-customer-service-windows'
  | 'missing-shop-hours'

export interface RoutePlanningReadiness {
  readyForRouteOptimization: false
  customers: CustomerScheduleReadiness[]
  customersWithScheduleIds: string[]
  customersWithoutScheduleIds: string[]
  scheduleCoverage: {
    observedCustomers: number
    totalCustomers: number
  }
  blockers: RoutePlanningBlocker[]
}

function parseTimePoint(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }

  return hour * 60 + minute
}

export function parseApproxTime(raw: string): ParsedApproxTime {
  const trimmed = raw.trim()
  const point = parseTimePoint(trimmed)
  if (point !== null) {
    return {
      kind: 'point',
      raw,
      minutesSinceMidnight: point,
    }
  }

  const rangeMatch =
    /^(\d{1,2}:\d{2})\s*[～~\-–—]\s*(\d{1,2}:\d{2})$/.exec(
      trimmed,
    )
  if (rangeMatch) {
    const start = parseTimePoint(rangeMatch[1])
    const end = parseTimePoint(rangeMatch[2])
    if (start !== null && end !== null && start <= end) {
      return {
        kind: 'range',
        raw,
        startMinutesSinceMidnight: start,
        endMinutesSinceMidnight: end,
      }
    }
  }

  return {
    kind: 'unparsed',
    raw,
  }
}

function normalizeObservation(
  observation: ScheduleObservation,
): NormalizedScheduleObservation {
  if (observation.type === 'leave_home') {
    return {
      type: observation.type,
      approxTime: parseApproxTime(observation.approxTime),
      note: observation.note,
      meaning: 'leave-home-only',
      describesVillagePresence: false,
    }
  }

  if (observation.type === 'outside_village_by') {
    return {
      type: observation.type,
      approxTime: parseApproxTime(observation.approxTime),
      note: observation.note,
      meaning: 'outside-village-by',
      describesVillagePresence: true,
    }
  }

  return {
    type: observation.type,
    approxTime: parseApproxTime(observation.approxTime),
    note: observation.note,
    meaning: 'return-village',
    describesVillagePresence: true,
  }
}

export function buildCustomerScheduleReadiness(
  customer: Customer,
): CustomerScheduleReadiness {
  const observations = (customer.schedule ?? []).map(normalizeObservation)
  const blockers = new Set<CustomerScheduleBlocker>()

  if (observations.length === 0) {
    blockers.add('no-schedule-observation')
  }

  if (observations.some((item) => item.type === 'leave_home')) {
    blockers.add('leave-home-not-village-boundary')
  }

  if (observations.some((item) => item.type === 'outside_village_by')) {
    blockers.add('outside-village-departure-time-unknown')
  }

  const hasDepartureLikeObservation = observations.some(
    (item) =>
      item.type === 'leave_home' ||
      item.type === 'outside_village_by',
  )
  const hasReturnObservation = observations.some(
    (item) => item.type === 'return_village',
  )

  if (hasDepartureLikeObservation && !hasReturnObservation) {
    blockers.add('return-time-unknown')
  }

  // Current source never provides a complete service window.
  // Keep this explicit instead of deriving a window from approximate observations.
  blockers.add('service-window-not-established')

  return {
    customerId: customer.id,
    customerName: customer.name,
    villageId: customer.villageId,
    observations,
    blockers: [...blockers],
    hasObservedSchedule: observations.length > 0,
    hasCompleteServiceWindow: false,
  }
}

export function buildRoutePlanningReadiness(
  customers: Customer[] = canonicalCustomers,
): RoutePlanningReadiness {
  const readiness = customers.map(buildCustomerScheduleReadiness)
  const customersWithScheduleIds = readiness
    .filter((customer) => customer.hasObservedSchedule)
    .map((customer) => customer.customerId)
  const customersWithoutScheduleIds = readiness
    .filter((customer) => !customer.hasObservedSchedule)
    .map((customer) => customer.customerId)

  return {
    readyForRouteOptimization: false,
    customers: readiness,
    customersWithScheduleIds,
    customersWithoutScheduleIds,
    scheduleCoverage: {
      observedCustomers: customersWithScheduleIds.length,
      totalCustomers: readiness.length,
    },
    blockers: [
      'missing-cross-village-travel-time',
      'missing-location-identity',
      'incomplete-customer-service-windows',
      'missing-shop-hours',
    ],
  }
}
