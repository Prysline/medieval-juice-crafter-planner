import {
  BACKPACK_SLOT_CAPACITY,
  CLEAN_CUP_STACK_CAPACITY,
  JUICE_JAR_CAPACITY,
  JUICE_JAR_RACK_CAPACITY,
  JUICE_JAR_SLOT_COST,
} from './inventoryRules'
import type { PreparationDemand } from './preparationDemand'

export type UsedCupTripPolicy =
  | 'retain-and-wash'
  | 'allow-drop-if-full'

export interface MultiTripJuiceJarLoad {
  recipeId: string
  recipeName: string
  servings: number
  slotCost: 1
}

export interface MultiTripSalesTrip {
  tripNumber: number
  juiceJars: MultiTripJuiceJarLoad[]
  totalServings: number
  cleanCupStacks: number
  cleanCupsCarried: number
  departureSlots: number
  effectiveDepartureSlotLimit: number
  spareDepartureSlots: number
  reservedTransientUsedCupSlot: number
  usedCupDropMayOccur: boolean
  jarRackSlotsRequired: number
}

export interface MultiTripReplenishmentPlan {
  policy: UsedCupTripPolicy
  trips: MultiTripSalesTrip[]
  tripCount: number
  totalAssignedServings: number
  totalJuiceJars: number
  maxJarRackSlotsUsed: number
  cleanCupUnitsRequiredWithoutMiddayWashing: number
  reusableCleanCupPoolSize: number | null
  betweenTripWashWaterUnits: number
  returnsHomeBetweenTrips: boolean
}

interface MutableTrip {
  juiceJars: MultiTripJuiceJarLoad[]
  totalServings: number
}

function splitServings(
  recipeId: string,
  recipeName: string,
  servings: number,
): MultiTripJuiceJarLoad[] {
  const jars: MultiTripJuiceJarLoad[] = []
  let remaining = Math.max(0, Math.floor(servings))

  while (remaining > 0) {
    const jarServings = Math.min(remaining, JUICE_JAR_CAPACITY)
    jars.push({
      recipeId,
      recipeName,
      servings: jarServings,
      slotCost: JUICE_JAR_SLOT_COST,
    })
    remaining -= jarServings
  }

  return jars
}

function cleanCupStacksFor(servings: number): number {
  return Math.ceil(servings / CLEAN_CUP_STACK_CAPACITY)
}

function effectiveDepartureSlotLimit(
  policy: UsedCupTripPolicy,
): number {
  return policy === 'retain-and-wash'
    ? BACKPACK_SLOT_CAPACITY - 1
    : BACKPACK_SLOT_CAPACITY
}

function canAddJar(
  trip: MutableTrip,
  jar: MultiTripJuiceJarLoad,
  policy: UsedCupTripPolicy,
): boolean {
  const jarCount = trip.juiceJars.length + 1
  if (jarCount > JUICE_JAR_RACK_CAPACITY) return false

  const servings = trip.totalServings + jar.servings
  const cupStacks = cleanCupStacksFor(servings)
  const departureSlots = jarCount + cupStacks

  return departureSlots <= effectiveDepartureSlotLimit(policy)
}

function sortedJarLoads(
  demand: PreparationDemand,
): MultiTripJuiceJarLoad[] {
  return demand.recipes
    .flatMap((recipe) =>
      splitServings(
        recipe.recipeId,
        recipe.recipeName,
        recipe.assignedServings,
      ),
    )
    .sort(
      (a, b) =>
        b.servings - a.servings ||
        a.recipeName.localeCompare(b.recipeName, 'zh-Hant') ||
        a.recipeId.localeCompare(b.recipeId),
    )
}

export function buildMultiTripReplenishmentPlan(
  demand: PreparationDemand,
  policy: UsedCupTripPolicy,
): MultiTripReplenishmentPlan {
  const jarLoads = sortedJarLoads(demand)
  const mutableTrips: MutableTrip[] = []

  for (const jar of jarLoads) {
    const existing = mutableTrips.find((trip) =>
      canAddJar(trip, jar, policy),
    )

    if (existing) {
      existing.juiceJars.push(jar)
      existing.totalServings += jar.servings
      continue
    }

    const fresh: MutableTrip = {
      juiceJars: [],
      totalServings: 0,
    }

    if (!canAddJar(fresh, jar, policy)) {
      throw new Error(
        `A single jar cannot fit the ${policy} trip policy`,
      )
    }

    fresh.juiceJars.push(jar)
    fresh.totalServings = jar.servings
    mutableTrips.push(fresh)
  }

  const slotLimit = effectiveDepartureSlotLimit(policy)
  const trips: MultiTripSalesTrip[] = mutableTrips.map(
    (trip, index) => {
      const cleanCupStacks = cleanCupStacksFor(trip.totalServings)
      const departureSlots =
        trip.juiceJars.length + cleanCupStacks

      return {
        tripNumber: index + 1,
        juiceJars: trip.juiceJars,
        totalServings: trip.totalServings,
        cleanCupStacks,
        cleanCupsCarried: trip.totalServings,
        departureSlots,
        effectiveDepartureSlotLimit: slotLimit,
        spareDepartureSlots:
          BACKPACK_SLOT_CAPACITY - departureSlots,
        reservedTransientUsedCupSlot:
          policy === 'retain-and-wash' && trip.totalServings > 0
            ? 1
            : 0,
        usedCupDropMayOccur:
          policy === 'allow-drop-if-full' &&
          trip.totalServings > 0 &&
          departureSlots === BACKPACK_SLOT_CAPACITY,
        jarRackSlotsRequired: trip.juiceJars.length,
      }
    },
  )

  const totalAssignedServings = trips.reduce(
    (sum, trip) => sum + trip.totalServings,
    0,
  )

  return {
    policy,
    trips,
    tripCount: trips.length,
    totalAssignedServings,
    totalJuiceJars: jarLoads.length,
    maxJarRackSlotsUsed: trips.reduce(
      (max, trip) => Math.max(max, trip.jarRackSlotsRequired),
      0,
    ),
    cleanCupUnitsRequiredWithoutMiddayWashing:
      totalAssignedServings,
    reusableCleanCupPoolSize:
      policy === 'retain-and-wash'
        ? trips.reduce(
            (max, trip) => Math.max(max, trip.totalServings),
            0,
          )
        : null,
    betweenTripWashWaterUnits:
      policy === 'retain-and-wash'
        ? trips
            .slice(0, -1)
            .reduce((sum, trip) => sum + trip.totalServings, 0)
        : 0,
    returnsHomeBetweenTrips: trips.length > 1,
  }
}
