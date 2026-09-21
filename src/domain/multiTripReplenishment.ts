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

export type JuiceJarFillAction =
  | 'initial-fill'
  | 'refill-same-type'
  | 'type-switch'

export interface MultiTripJuiceJarLoad {
  physicalJarId: number
  recipeId: string
  recipeName: string
  customerIds: string[]
  servings: number
  slotCost: 1
  fillAction: JuiceJarFillAction
  previousRecipeId: string | null
  previousRecipeName: string | null
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
  availableJuiceJarCount: number
  physicalJarsUsed: number
  totalJarLoads: number
  distinctFinalJuiceTypes: number
  jarTypeSwitches: number
  trips: MultiTripSalesTrip[]
  tripCount: number
  totalAssignedServings: number
  maxJarRackSlotsUsed: number
  cleanCupUnitsRequiredWithoutMiddayWashing: number
  reusableCleanCupPoolSize: number | null
  betweenTripWashWaterUnits: number
  returnsHomeBetweenTrips: boolean
}

interface RecipeJarChunk {
  servings: number
  customerIds: string[]
}

interface RecipeJarDemand {
  recipeId: string
  recipeName: string
  servings: number
  chunks: RecipeJarChunk[]
}

interface JarQueue {
  physicalJarId: number
  loads: MultiTripJuiceJarLoad[]
}

interface MutableTrip {
  juiceJars: MultiTripJuiceJarLoad[]
  totalServings: number
}

function normalizedAvailableJuiceJarCount(value: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : 1
}

function splitCustomerServings(
  customerIds: string[],
  servings: number,
): RecipeJarChunk[] {
  const normalizedServings = Math.max(0, Math.floor(servings))
  if (customerIds.length !== normalizedServings) {
    throw new Error(
      'Sales demand customer assignments do not match assigned servings',
    )
  }

  const chunks: RecipeJarChunk[] = []
  for (
    let start = 0;
    start < customerIds.length;
    start += JUICE_JAR_CAPACITY
  ) {
    const chunkCustomerIds = customerIds.slice(
      start,
      start + JUICE_JAR_CAPACITY,
    )
    chunks.push({
      servings: chunkCustomerIds.length,
      customerIds: chunkCustomerIds,
    })
  }

  return chunks
}

function recipeJarDemands(
  demand: PreparationDemand,
): RecipeJarDemand[] {
  return demand.recipes
    .map((recipe) => ({
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
      servings: Math.max(0, Math.floor(recipe.assignedServings)),
      chunks: splitCustomerServings(
        recipe.customerIds,
        recipe.assignedServings,
      ),
    }))
    .filter((recipe) => recipe.chunks.length > 0)
    .sort(
      (a, b) =>
        b.chunks.length - a.chunks.length ||
        b.servings - a.servings ||
        a.recipeName.localeCompare(b.recipeName, 'zh-Hant') ||
        a.recipeId.localeCompare(b.recipeId),
    )
}

function appendRecipeChunks(
  queue: JarQueue,
  recipe: RecipeJarDemand,
  chunks: RecipeJarChunk[],
): void {
  for (const chunk of chunks) {
    const previous = queue.loads.at(-1)
    const previousRecipeId = previous?.recipeId ?? null
    const previousRecipeName = previous?.recipeName ?? null
    const fillAction: JuiceJarFillAction = !previous
      ? 'initial-fill'
      : previous.recipeId === recipe.recipeId
        ? 'refill-same-type'
        : 'type-switch'

    queue.loads.push({
      physicalJarId: queue.physicalJarId,
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
      customerIds: [...chunk.customerIds],
      servings: chunk.servings,
      slotCost: JUICE_JAR_SLOT_COST,
      fillAction,
      previousRecipeId,
      previousRecipeName,
    })
  }
}

function buildJarQueuesWithSwitches(
  recipes: RecipeJarDemand[],
  availableJuiceJarCount: number,
): JarQueue[] {
  const queues = Array.from(
    { length: availableJuiceJarCount },
    (_, index): JarQueue => ({
      physicalJarId: index + 1,
      loads: [],
    }),
  )

  recipes.forEach((recipe, index) => {
    const target =
      index < availableJuiceJarCount
        ? queues[index]
        : [...queues].sort(
            (a, b) =>
              a.loads.length - b.loads.length ||
              a.loads.reduce(
                (sum, load) => sum + load.servings,
                0,
              ) -
                b.loads.reduce(
                  (sum, load) => sum + load.servings,
                  0,
                ) ||
              a.physicalJarId - b.physicalJarId,
          )[0]

    appendRecipeChunks(target, recipe, recipe.chunks)
  })

  return queues
}

function buildJarQueuesWithoutSwitches(
  recipes: RecipeJarDemand[],
  availableJuiceJarCount: number,
): JarQueue[] {
  const totalJarLoads = recipes.reduce(
    (sum, recipe) => sum + recipe.chunks.length,
    0,
  )
  const jarsToUse = Math.min(
    availableJuiceJarCount,
    totalJarLoads,
  )
  const allocatedByRecipeId = new Map(
    recipes.map((recipe) => [recipe.recipeId, 1]),
  )
  let remaining = jarsToUse - recipes.length

  while (remaining > 0) {
    const candidate = [...recipes]
      .filter(
        (recipe) =>
          (allocatedByRecipeId.get(recipe.recipeId) ?? 1) <
          recipe.chunks.length,
      )
      .sort((a, b) => {
        const allocatedA =
          allocatedByRecipeId.get(a.recipeId) ?? 1
        const allocatedB =
          allocatedByRecipeId.get(b.recipeId) ?? 1
        const pressureA = Math.ceil(
          a.chunks.length / allocatedA,
        )
        const pressureB = Math.ceil(
          b.chunks.length / allocatedB,
        )

        return (
          pressureB - pressureA ||
          b.chunks.length / allocatedB -
            a.chunks.length / allocatedA ||
          b.servings - a.servings ||
          a.recipeName.localeCompare(
            b.recipeName,
            'zh-Hant',
          ) ||
          a.recipeId.localeCompare(b.recipeId)
        )
      })[0]

    if (!candidate) break
    allocatedByRecipeId.set(
      candidate.recipeId,
      (allocatedByRecipeId.get(candidate.recipeId) ?? 1) + 1,
    )
    remaining -= 1
  }

  const queues: JarQueue[] = []
  let nextPhysicalJarId = 1

  for (const recipe of recipes) {
    const count =
      allocatedByRecipeId.get(recipe.recipeId) ?? 1
    const recipeQueues = Array.from(
      { length: count },
      (): JarQueue => ({
        physicalJarId: nextPhysicalJarId++,
        loads: [],
      }),
    )

    recipe.chunks.forEach((chunk, index) => {
      appendRecipeChunks(
        recipeQueues[index % recipeQueues.length],
        recipe,
        [chunk],
      )
    })
    queues.push(...recipeQueues)
  }

  return queues
}

function buildPhysicalJarQueues(
  recipes: RecipeJarDemand[],
  availableJuiceJarCount: number,
): JarQueue[] {
  if (recipes.length === 0) return []

  return recipes.length > availableJuiceJarCount
    ? buildJarQueuesWithSwitches(
        recipes,
        availableJuiceJarCount,
      )
    : buildJarQueuesWithoutSwitches(
        recipes,
        availableJuiceJarCount,
      )
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
  maxConcurrentJars: number,
): boolean {
  const jarCount = trip.juiceJars.length + 1
  if (jarCount > maxConcurrentJars) return false

  const servings = trip.totalServings + jar.servings
  const cupStacks = cleanCupStacksFor(servings)
  const departureSlots = jarCount + cupStacks

  return (
    departureSlots <= effectiveDepartureSlotLimit(policy)
  )
}

function buildTrips(
  queues: JarQueue[],
  policy: UsedCupTripPolicy,
  availableJuiceJarCount: number,
): MutableTrip[] {
  const pending = queues.map((queue) => ({
    physicalJarId: queue.physicalJarId,
    loads: [...queue.loads],
  }))
  const trips: MutableTrip[] = []
  const maxConcurrentJars = Math.min(
    availableJuiceJarCount,
    JUICE_JAR_RACK_CAPACITY,
  )

  while (pending.some((queue) => queue.loads.length > 0)) {
    const candidates = pending
      .flatMap((queue) =>
        queue.loads[0] ? [queue.loads[0]] : [],
      )
      .sort(
        (a, b) =>
          b.servings - a.servings ||
          a.recipeName.localeCompare(
            b.recipeName,
            'zh-Hant',
          ) ||
          a.recipeId.localeCompare(b.recipeId) ||
          a.physicalJarId - b.physicalJarId,
      )

    const trip: MutableTrip = {
      juiceJars: [],
      totalServings: 0,
    }
    const selectedJarIds = new Set<number>()

    for (const jar of candidates) {
      if (
        !canAddJar(
          trip,
          jar,
          policy,
          maxConcurrentJars,
        )
      ) {
        continue
      }
      trip.juiceJars.push(jar)
      trip.totalServings += jar.servings
      selectedJarIds.add(jar.physicalJarId)
    }

    if (trip.juiceJars.length === 0) {
      throw new Error(
        `A single jar cannot fit the ${policy} trip policy`,
      )
    }

    for (const queue of pending) {
      if (selectedJarIds.has(queue.physicalJarId)) {
        queue.loads.shift()
      }
    }
    trips.push(trip)
  }

  return trips
}

export function countJarTypeSwitchesFromSchedule(
  trips: MultiTripSalesTrip[],
): number {
  const lastRecipeByJar = new Map<number, string>()
  let switches = 0

  for (const trip of trips) {
    const seenJarIds = new Set<number>()

    for (const load of trip.juiceJars) {
      if (seenJarIds.has(load.physicalJarId)) {
        throw new Error(
          `Physical jar ${load.physicalJarId} appears more than once in trip ${trip.tripNumber}`,
        )
      }
      seenJarIds.add(load.physicalJarId)

      const previousRecipeId = lastRecipeByJar.get(
        load.physicalJarId,
      )
      const expectedAction: JuiceJarFillAction =
        previousRecipeId === undefined
          ? 'initial-fill'
          : previousRecipeId === load.recipeId
            ? 'refill-same-type'
            : 'type-switch'

      if (load.fillAction !== expectedAction) {
        throw new Error(
          `Jar ${load.physicalJarId} has inconsistent fill action in trip ${trip.tripNumber}`,
        )
      }

      if (expectedAction === 'type-switch') {
        switches += 1
      }
      lastRecipeByJar.set(
        load.physicalJarId,
        load.recipeId,
      )
    }
  }

  return switches
}

export function buildMultiTripReplenishmentPlan(
  demand: PreparationDemand,
  policy: UsedCupTripPolicy,
  availableJuiceJarCount: number,
): MultiTripReplenishmentPlan {
  const normalizedJarCount =
    normalizedAvailableJuiceJarCount(
      availableJuiceJarCount,
    )
  const recipes = recipeJarDemands(demand)
  const queues = buildPhysicalJarQueues(
    recipes,
    normalizedJarCount,
  )
  const mutableTrips = buildTrips(
    queues,
    policy,
    normalizedJarCount,
  )
  const slotLimit = effectiveDepartureSlotLimit(policy)
  const trips: MultiTripSalesTrip[] = mutableTrips.map(
    (trip, index) => {
      const cleanCupStacks = cleanCupStacksFor(
        trip.totalServings,
      )
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
          policy === 'retain-and-wash' &&
          trip.totalServings > 0
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
  const jarTypeSwitches =
    countJarTypeSwitchesFromSchedule(trips)
  const expectedMinimumSwitches = Math.max(
    0,
    recipes.length - normalizedJarCount,
  )

  if (jarTypeSwitches !== expectedMinimumSwitches) {
    throw new Error(
      'Physical jar schedule does not realize the minimum jar-switch count',
    )
  }

  const totalAssignedServings = trips.reduce(
    (sum, trip) => sum + trip.totalServings,
    0,
  )
  const physicalJarsUsed = queues.filter(
    (queue) => queue.loads.length > 0,
  ).length
  const totalJarLoads = queues.reduce(
    (sum, queue) => sum + queue.loads.length,
    0,
  )

  return {
    policy,
    availableJuiceJarCount: normalizedJarCount,
    physicalJarsUsed,
    totalJarLoads,
    distinctFinalJuiceTypes: recipes.length,
    jarTypeSwitches,
    trips,
    tripCount: trips.length,
    totalAssignedServings,
    maxJarRackSlotsUsed: trips.reduce(
      (max, trip) =>
        Math.max(max, trip.jarRackSlotsRequired),
      0,
    ),
    cleanCupUnitsRequiredWithoutMiddayWashing:
      totalAssignedServings,
    reusableCleanCupPoolSize:
      policy === 'retain-and-wash'
        ? trips.reduce(
            (max, trip) =>
              Math.max(max, trip.totalServings),
            0,
          )
        : null,
    betweenTripWashWaterUnits:
      policy === 'retain-and-wash'
        ? trips
            .slice(0, -1)
            .reduce(
              (sum, trip) =>
                sum + trip.totalServings,
              0,
            )
        : 0,
    returnsHomeBetweenTrips: trips.length > 1,
  }
}
