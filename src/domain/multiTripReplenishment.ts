import {
  BACKPACK_SLOT_CAPACITY,
  CLEAN_CUP_STACK_CAPACITY,
  JUICE_JAR_CAPACITY,
  JUICE_JAR_SLOT_COST,
} from './inventoryRules'
import type { JuiceJarInventoryItem } from '../types'
import type { PreparationDemand } from './preparationDemand'

export type UsedCupTripPolicy =
  | 'retain-and-wash'
  | 'allow-drop-if-full'

export type JuiceJarFillAction =
  | 'initial-fill'
  | 'refill-same-type'
  | 'type-switch'

export interface MultiTripJuiceJarLoad {
  physicalJarId: string
  recipeId: string
  recipeName: string
  customerIds: string[]
  /** Servings assigned to customers on this trip. */
  servings: number
  /** Produced servings that remain in this jar after the assigned sales. */
  retainedLeftoverServings: number
  slotCost: 1
  fillAction: JuiceJarFillAction
  previousRecipeId: string | null
  previousRecipeName: string | null
}

export interface MultiTripLeftoverJarContent {
  /** Persistent InventoryState.juiceJars[].id. */
  physicalJarId: string
  recipeId: string
  recipeName: string
  servings: number
  /** The trip whose sales load leaves these servings behind. */
  tripNumber: number
}

export interface MultiTripPhysicalJar {
  /** Persistent InventoryState.juiceJars[].id. */
  physicalJarId: string
  initialRecipeId: string | null
  initialServings: number
}

export interface CupInventoryInput {
  cleanCups: number
  usedCups: number
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
  droppedUsedCups: number
  cupsWashedBeforeTrip: number
  cupWashWaterUnits: number
  cleanCupsBeforeTrip: number
  usedCupsBeforeTrip: number
  cleanCupsAfterTrip: number
  usedCupsAfterTrip: number
  physicalCupsAfterTrip: number
  peakCupSlots: number
  peakOccupiedSlots: number
  juiceJarSlotsCarried: number
}

export interface MultiTripReplenishmentPlan {
  policy: UsedCupTripPolicy
  carriedJuiceJarCount: number
  carriedJuiceJars: MultiTripPhysicalJar[]
  physicalJarsUsed: number
  totalJarLoads: number
  distinctFinalJuiceTypes: number
  jarTypeSwitches: number
  trips: MultiTripSalesTrip[]
  tripCount: number
  totalAssignedServings: number
  totalLeftoverServings: number
  leftoverJarContents: MultiTripLeftoverJarContent[]
  maxJuiceJarSlotsCarried: number
  cleanCupUnitsRequiredWithoutMiddayWashing: number
  reusableCleanCupPoolSize: number | null
  initialCleanCups: number
  initialUsedCups: number
  initialPhysicalCupCount: number
  finalCleanCups: number
  finalUsedCups: number
  finalPhysicalCupCount: number
  droppedUsedCups: number
  initialWashWaterUnits: number
  betweenTripWashWaterUnits: number
  totalCupWashWaterUnits: number
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
  leftoverServings: number
  chunks: RecipeJarChunk[]
}

interface JarQueue {
  physicalJarId: string
  loads: MultiTripJuiceJarLoad[]
}

function normalizeCarriedJuiceJars(
  jars: JuiceJarInventoryItem[],
): MultiTripPhysicalJar[] {
  const limited = jars.slice(0, BACKPACK_SLOT_CAPACITY)
  const seen = new Set<string>()

  return limited.map((jar) => {
    if (!jar.id || seen.has(jar.id)) {
      throw new Error(
        'Carried physical juice jars require unique persistent inventory IDs',
      )
    }
    seen.add(jar.id)

    return {
      physicalJarId: jar.id,
      initialRecipeId: jar.recipeId,
      initialServings: jar.servings,
    }
  })
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
      leftoverServings: Math.max(
        0,
        Math.floor(recipe.leftoverServings),
      ),
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
      retainedLeftoverServings: 0,
      slotCost: JUICE_JAR_SLOT_COST,
      fillAction,
      previousRecipeId,
      previousRecipeName,
    })
  }
}

function queueLoadSort(a: JarQueue, b: JarQueue): number {
  return (
    a.loads.length - b.loads.length ||
    a.loads.reduce((sum, load) => sum + load.servings, 0) -
      b.loads.reduce((sum, load) => sum + load.servings, 0) ||
    a.physicalJarId.localeCompare(b.physicalJarId)
  )
}

function buildJarQueuesWithSwitches(
  recipes: RecipeJarDemand[],
  carriedJuiceJarIds: string[],
): JarQueue[] {
  const queues = carriedJuiceJarIds.map(
    (physicalJarId): JarQueue => ({
      physicalJarId,
      loads: [],
    }),
  )
  const carriedJuiceJarCount = carriedJuiceJarIds.length

  const terminalRecipes = [...recipes]
    .filter((recipe) => recipe.leftoverServings > 0)
    .sort(
      (a, b) =>
        b.leftoverServings - a.leftoverServings ||
        b.chunks.length - a.chunks.length ||
        b.servings - a.servings ||
        a.recipeName.localeCompare(b.recipeName, 'zh-Hant') ||
        a.recipeId.localeCompare(b.recipeId),
    )
    .slice(0, carriedJuiceJarCount)
  const terminalRecipeIds = new Set(
    terminalRecipes.map((recipe) => recipe.recipeId),
  )

  for (const recipe of recipes.filter(
    (item) => !terminalRecipeIds.has(item.recipeId),
  )) {
    const target = [...queues].sort(queueLoadSort)[0]
    appendRecipeChunks(target, recipe, recipe.chunks)
  }

  const availableTerminalQueues = [...queues]
  for (const recipe of terminalRecipes) {
    availableTerminalQueues.sort(queueLoadSort)
    const target = availableTerminalQueues.shift()
    if (!target) {
      throw new Error(
        'Leftover terminal jar allocation exceeded carried jar capacity',
      )
    }
    appendRecipeChunks(target, recipe, recipe.chunks)
  }

  return queues
}

function buildJarQueuesWithoutSwitches(
  recipes: RecipeJarDemand[],
  carriedJuiceJarIds: string[],
): JarQueue[] {
  const totalJarLoads = recipes.reduce(
    (sum, recipe) => sum + recipe.chunks.length,
    0,
  )
  const jarsToUse = Math.min(
    carriedJuiceJarIds.length,
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
  let nextPhysicalJarIndex = 0

  for (const recipe of recipes) {
    const count =
      allocatedByRecipeId.get(recipe.recipeId) ?? 1
    const recipeQueues = Array.from(
      { length: count },
      (): JarQueue => {
        const physicalJarId =
          carriedJuiceJarIds[nextPhysicalJarIndex++]
        if (!physicalJarId) {
          throw new Error(
            'Physical jar queue allocation exceeded carried jar identities',
          )
        }
        return {
          physicalJarId,
          loads: [],
        }
      },
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
  carriedJuiceJarIds: string[],
): JarQueue[] {
  if (recipes.length === 0) return []

  return recipes.length > carriedJuiceJarIds.length
    ? buildJarQueuesWithSwitches(
        recipes,
        carriedJuiceJarIds,
      )
    : buildJarQueuesWithoutSwitches(
        recipes,
        carriedJuiceJarIds,
      )
}

function cleanCupStacksFor(cups: number): number {
  return Math.ceil(Math.max(0, cups) / CLEAN_CUP_STACK_CAPACITY)
}

interface CupState {
  cleanCups: number
  usedCups: number
}

interface CupTripTransition {
  cleanCupsBeforeTrip: number
  usedCupsBeforeTrip: number
  cupsWashedBeforeTrip: number
  cleanCupsCarried: number
  departureCupSlots: number
  peakCupSlots: number
  droppedUsedCups: number
  returnedUsedCups: number
  cleanCupsAfterTrip: number
  usedCupsAfterTrip: number
}

interface MutableTrip {
  juiceJars: MultiTripJuiceJarLoad[]
  totalServings: number
  cupTransition: CupTripTransition
}

function normalizedCupCount(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

function simulateCupTrip(
  state: CupState,
  servings: number,
  policy: UsedCupTripPolicy,
  fixedJarSlots: number,
): CupTripTransition | null {
  const normalizedServings = Math.max(0, Math.floor(servings))
  const cleanCupsBeforeTrip = normalizedCupCount(state.cleanCups)
  const usedCupsBeforeTrip = normalizedCupCount(state.usedCups)

  if (normalizedServings === 0) {
    return {
      cleanCupsBeforeTrip,
      usedCupsBeforeTrip,
      cupsWashedBeforeTrip: 0,
      cleanCupsCarried: 0,
      departureCupSlots: 0,
      peakCupSlots: 0,
      droppedUsedCups: 0,
      returnedUsedCups: 0,
      cleanCupsAfterTrip: cleanCupsBeforeTrip,
      usedCupsAfterTrip: usedCupsBeforeTrip,
    }
  }

  const cupsWashedBeforeTrip = Math.max(
    0,
    normalizedServings - cleanCupsBeforeTrip,
  )
  if (cupsWashedBeforeTrip > usedCupsBeforeTrip) return null

  const cleanAfterWash =
    cleanCupsBeforeTrip + cupsWashedBeforeTrip
  const usedAfterWash =
    usedCupsBeforeTrip - cupsWashedBeforeTrip
  const departureCupSlots = cleanCupStacksFor(normalizedServings)

  if (
    fixedJarSlots + departureCupSlots >
    BACKPACK_SLOT_CAPACITY
  ) {
    return null
  }

  const cleanCupsLeftHome =
    cleanAfterWash - normalizedServings
  let carriedCleanCups = normalizedServings
  let carriedUsedCups = 0
  let droppedUsedCups = 0
  let peakCupSlots = departureCupSlots

  for (let served = 0; served < normalizedServings; served += 1) {
    carriedCleanCups -= 1
    const returnedCupCount = carriedUsedCups + 1
    const cupSlotsIfReturned =
      cleanCupStacksFor(carriedCleanCups) +
      cleanCupStacksFor(returnedCupCount)

    if (
      fixedJarSlots + cupSlotsIfReturned <=
      BACKPACK_SLOT_CAPACITY
    ) {
      carriedUsedCups = returnedCupCount
    } else if (policy === 'allow-drop-if-full') {
      droppedUsedCups += 1
    } else {
      return null
    }

    peakCupSlots = Math.max(
      peakCupSlots,
      cleanCupStacksFor(carriedCleanCups) +
        cleanCupStacksFor(carriedUsedCups),
    )
  }

  return {
    cleanCupsBeforeTrip,
    usedCupsBeforeTrip,
    cupsWashedBeforeTrip,
    cleanCupsCarried: normalizedServings,
    departureCupSlots,
    peakCupSlots,
    droppedUsedCups,
    returnedUsedCups: carriedUsedCups,
    cleanCupsAfterTrip: cleanCupsLeftHome,
    usedCupsAfterTrip: usedAfterWash + carriedUsedCups,
  }
}

function buildTrips(
  queues: JarQueue[],
  policy: UsedCupTripPolicy,
  carriedJuiceJarCount: number,
  initialCupState: CupState,
): {
  trips: MutableTrip[]
  finalCupState: CupState
} {
  const pending = queues.map((queue) => ({
    physicalJarId: queue.physicalJarId,
    loads: queue.loads.map((load) => ({
      ...load,
      customerIds: [...load.customerIds],
    })),
  }))
  const trips: MutableTrip[] = []
  const maxConcurrentJars = carriedJuiceJarCount
  let cupState: CupState = {
    cleanCups: normalizedCupCount(initialCupState.cleanCups),
    usedCups: normalizedCupCount(initialCupState.usedCups),
  }

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
          a.physicalJarId.localeCompare(b.physicalJarId),
      )

    const trip = {
      juiceJars: [] as MultiTripJuiceJarLoad[],
      totalServings: 0,
    }
    const selectedServingsByJarId = new Map<string, number>()

    for (const jar of candidates) {
      let servingsToTake = 0

      for (
        let candidateServings = jar.servings;
        candidateServings >= 1;
        candidateServings -= 1
      ) {
        const transition = simulateCupTrip(
          cupState,
          trip.totalServings + candidateServings,
          policy,
          maxConcurrentJars,
        )
        if (transition) {
          servingsToTake = candidateServings
          break
        }
      }

      if (servingsToTake === 0) continue

      trip.juiceJars.push({
        ...jar,
        servings: servingsToTake,
        customerIds: jar.customerIds.slice(0, servingsToTake),
      })
      trip.totalServings += servingsToTake
      selectedServingsByJarId.set(
        jar.physicalJarId,
        servingsToTake,
      )
    }

    if (trip.juiceJars.length === 0) {
      if (cupState.cleanCups + cupState.usedCups < 1) {
        throw new Error(
          'Sales planning requires at least one physical cup',
        )
      }
      throw new Error(
        `No remaining sales load can fit the ${policy} trip policy with the current cups and backpack slots`,
      )
    }

    const cupTransition = simulateCupTrip(
      cupState,
      trip.totalServings,
      policy,
      maxConcurrentJars,
    )
    if (!cupTransition) {
      throw new Error(
        'Cup lifecycle simulation became inconsistent with the selected trip',
      )
    }

    cupState = {
      cleanCups: cupTransition.cleanCupsAfterTrip,
      usedCups: cupTransition.usedCupsAfterTrip,
    }

    for (const queue of pending) {
      const served =
        selectedServingsByJarId.get(queue.physicalJarId) ?? 0
      if (served === 0) continue

      const head = queue.loads[0]
      if (!head || served > head.servings) {
        throw new Error(
          'Physical jar queue became inconsistent while splitting a sales load',
        )
      }

      if (served === head.servings) {
        queue.loads.shift()
        continue
      }

      head.servings -= served
      head.customerIds = head.customerIds.slice(served)
      head.fillAction = 'refill-same-type'
      head.previousRecipeId = head.recipeId
      head.previousRecipeName = head.recipeName
    }

    trips.push({
      ...trip,
      cupTransition,
    })
  }

  return {
    trips,
    finalCupState: cupState,
  }
}

function allocateLeftoverJarContents(
  demand: PreparationDemand,
  trips: MultiTripSalesTrip[],
): MultiTripLeftoverJarContent[] {
  const expectedTotal = demand.recipes.reduce(
    (sum, recipe) =>
      sum + Math.max(0, Math.floor(recipe.leftoverServings)),
    0,
  )
  const normalizedDemandTotal = Math.max(
    0,
    Math.floor(demand.leftoverServings),
  )
  if (expectedTotal !== normalizedDemandTotal) {
    throw new Error(
      'Recipe leftover servings do not match total preparation leftovers',
    )
  }
  if (expectedTotal === 0) return []

  const lastSalesLoadByJar = new Map<
    string,
    {
      trip: MultiTripSalesTrip
      load: MultiTripJuiceJarLoad
    }
  >()
  for (const trip of trips) {
    for (const load of trip.juiceJars) {
      lastSalesLoadByJar.set(load.physicalJarId, { trip, load })
    }
  }

  const contents: MultiTripLeftoverJarContent[] = []
  const remainingByRecipe = new Map(
    demand.recipes
      .map((recipe) => [
        recipe.recipeId,
        Math.max(0, Math.floor(recipe.leftoverServings)),
      ] as const)
      .filter(([, servings]) => servings > 0),
  )

  const finalSalesCandidates = [...lastSalesLoadByJar.values()]
    .filter(({ load }) => {
      const remaining = remainingByRecipe.get(load.recipeId) ?? 0
      return (
        remaining > 0 &&
        load.servings + load.retainedLeftoverServings <
          JUICE_JAR_CAPACITY
      )
    })
    .sort(
      (a, b) =>
        (remainingByRecipe.get(b.load.recipeId) ?? 0) -
          (remainingByRecipe.get(a.load.recipeId) ?? 0) ||
        b.load.servings - a.load.servings ||
        a.load.physicalJarId - b.load.physicalJarId,
    )

  for (const candidate of finalSalesCandidates) {
    const recipeId = candidate.load.recipeId
    const remaining = remainingByRecipe.get(recipeId) ?? 0
    if (remaining <= 0) continue

    const freeCapacity =
      JUICE_JAR_CAPACITY -
      candidate.load.servings -
      candidate.load.retainedLeftoverServings
    const retained = Math.min(remaining, freeCapacity)
    if (retained <= 0) continue

    candidate.load.retainedLeftoverServings += retained
    remainingByRecipe.set(recipeId, remaining - retained)
    contents.push({
      physicalJarId: candidate.load.physicalJarId,
      recipeId,
      recipeName: candidate.load.recipeName,
      servings: retained,
      tripNumber: candidate.trip.tripNumber,
    })
  }

  const unallocated = [...remainingByRecipe.values()].reduce(
    (sum, servings) => sum + servings,
    0,
  )
  if (unallocated > 0) {
    throw new Error(
      `Not enough terminal sales-jar capacity to preserve ${unallocated} leftover serving(s) without switching away from retained juice`,
    )
  }

  const allocated = contents.reduce(
    (sum, item) => sum + item.servings,
    0,
  )
  if (allocated !== expectedTotal) {
    throw new Error(
      'Leftover jar allocation did not preserve every produced serving',
    )
  }

  for (const trip of trips) {
    for (const load of trip.juiceJars) {
      if (
        load.servings + load.retainedLeftoverServings >
        JUICE_JAR_CAPACITY
      ) {
        throw new Error(
          `Physical jar ${load.physicalJarId} exceeds juice capacity in trip ${trip.tripNumber}`,
        )
      }
    }
  }

  return contents.sort(
    (a, b) =>
      a.physicalJarId.localeCompare(b.physicalJarId) ||
      a.recipeName.localeCompare(b.recipeName, 'zh-Hant') ||
      a.recipeId.localeCompare(b.recipeId),
  )
}

export function countJarTypeSwitchesFromSchedule(
  trips: MultiTripSalesTrip[],
): number {
  const lastRecipeByJar = new Map<string, string>()
  let switches = 0

  for (const trip of trips) {
    const seenJarIds = new Set<string>()

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
  carriedJuiceJarInventory: JuiceJarInventoryItem[],
  cups: CupInventoryInput,
): MultiTripReplenishmentPlan {
  const carriedJuiceJars =
    normalizeCarriedJuiceJars(carriedJuiceJarInventory)
  const carriedJuiceJarIds = carriedJuiceJars.map(
    (jar) => jar.physicalJarId,
  )
  const normalizedJarCount = carriedJuiceJarIds.length
  const initialCupState: CupState = {
    cleanCups: normalizedCupCount(cups.cleanCups),
    usedCups: normalizedCupCount(cups.usedCups),
  }
  const recipes = recipeJarDemands(demand)

  if (recipes.length > 0 && normalizedJarCount < 1) {
    throw new Error(
      'Sales planning requires at least one carried physical juice jar',
    )
  }
  if (
    recipes.length > 0 &&
    initialCupState.cleanCups + initialCupState.usedCups < 1
  ) {
    throw new Error(
      'Sales planning requires at least one physical cup',
    )
  }

  const queues = buildPhysicalJarQueues(
    recipes,
    carriedJuiceJarIds,
  )
  const { trips: mutableTrips, finalCupState } = buildTrips(
    queues,
    policy,
    normalizedJarCount,
    initialCupState,
  )
  const trips: MultiTripSalesTrip[] = mutableTrips.map(
    (trip, index) => {
      const transition = trip.cupTransition
      const cleanCupStacks =
        transition.departureCupSlots
      const departureSlots =
        normalizedJarCount + cleanCupStacks

      return {
        tripNumber: index + 1,
        juiceJars: trip.juiceJars,
        totalServings: trip.totalServings,
        cleanCupStacks,
        cleanCupsCarried: transition.cleanCupsCarried,
        departureSlots,
        effectiveDepartureSlotLimit:
          BACKPACK_SLOT_CAPACITY,
        spareDepartureSlots:
          BACKPACK_SLOT_CAPACITY - departureSlots,
        reservedTransientUsedCupSlot: Math.max(
          0,
          transition.peakCupSlots - cleanCupStacks,
        ),
        usedCupDropMayOccur:
          transition.droppedUsedCups > 0,
        droppedUsedCups: transition.droppedUsedCups,
        cupsWashedBeforeTrip:
          transition.cupsWashedBeforeTrip,
        cupWashWaterUnits:
          transition.cupsWashedBeforeTrip,
        cleanCupsBeforeTrip:
          transition.cleanCupsBeforeTrip,
        usedCupsBeforeTrip:
          transition.usedCupsBeforeTrip,
        cleanCupsAfterTrip:
          transition.cleanCupsAfterTrip,
        usedCupsAfterTrip:
          transition.usedCupsAfterTrip,
        physicalCupsAfterTrip:
          transition.cleanCupsAfterTrip +
          transition.usedCupsAfterTrip,
        peakCupSlots: transition.peakCupSlots,
        peakOccupiedSlots:
          normalizedJarCount + transition.peakCupSlots,
        juiceJarSlotsCarried: normalizedJarCount,
      }
    },
  )
  const leftoverJarContents = allocateLeftoverJarContents(
    demand,
    trips,
  )
  const totalLeftoverServings = leftoverJarContents.reduce(
    (sum, item) => sum + item.servings,
    0,
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
  if (totalAssignedServings !== demand.assignedServings) {
    throw new Error(
      'Physical cup lifecycle did not schedule every assigned serving',
    )
  }

  const physicalJarIdsUsed = new Set(
    trips.flatMap((trip) =>
      trip.juiceJars.map((load) => load.physicalJarId),
    ),
  )
  const totalJarLoads = trips.reduce(
    (sum, trip) => sum + trip.juiceJars.length,
    0,
  )
  const droppedUsedCups = trips.reduce(
    (sum, trip) => sum + trip.droppedUsedCups,
    0,
  )
  const initialPhysicalCupCount =
    initialCupState.cleanCups + initialCupState.usedCups
  const finalPhysicalCupCount =
    finalCupState.cleanCups + finalCupState.usedCups

  if (
    finalPhysicalCupCount !==
    initialPhysicalCupCount - droppedUsedCups
  ) {
    throw new Error(
      'Cup lifecycle did not conserve physical cup ownership',
    )
  }

  const initialWashWaterUnits =
    trips[0]?.cupWashWaterUnits ?? 0
  const betweenTripWashWaterUnits = trips
    .slice(1)
    .reduce(
      (sum, trip) => sum + trip.cupWashWaterUnits,
      0,
    )
  const totalCupWashWaterUnits =
    initialWashWaterUnits + betweenTripWashWaterUnits

  return {
    policy,
    carriedJuiceJarCount: normalizedJarCount,
    carriedJuiceJars,
    physicalJarsUsed: physicalJarIdsUsed.size,
    totalJarLoads,
    distinctFinalJuiceTypes: recipes.length,
    jarTypeSwitches,
    trips,
    tripCount: trips.length,
    totalAssignedServings,
    totalLeftoverServings,
    leftoverJarContents,
    maxJuiceJarSlotsCarried: trips.reduce(
      (max, trip) =>
        Math.max(max, trip.juiceJarSlotsCarried),
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
    initialCleanCups: initialCupState.cleanCups,
    initialUsedCups: initialCupState.usedCups,
    initialPhysicalCupCount,
    finalCleanCups: finalCupState.cleanCups,
    finalUsedCups: finalCupState.usedCups,
    finalPhysicalCupCount,
    droppedUsedCups,
    initialWashWaterUnits,
    betweenTripWashWaterUnits,
    totalCupWashWaterUnits,
    returnsHomeBetweenTrips: trips.length > 1,
  }
}
