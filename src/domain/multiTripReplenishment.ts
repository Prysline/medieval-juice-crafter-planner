import {
  BACKPACK_SLOT_CAPACITY,
  CLEAN_CUP_STACK_CAPACITY,
  JUICE_JAR_CAPACITY,
  JUICE_JAR_SLOT_COST,
} from './inventoryRules'
import type { JuiceJarInventoryItem } from '../types'
import type { PreparationDemand } from './preparationDemand'
import type { PreparationShortfall } from './preparationShortfall'
import {
  planMinimumJarTypeSwitchSequences,
  type MinimumJarSwitchSequencePlan,
} from './jarSwitches'
import { PlanningUserError } from './planningErrors'

export type UsedCupTripPolicy =
  | 'retain-and-wash'
  | 'allow-drop-if-full'

export type JuiceJarFillAction =
  | 'use-existing'
  | 'continue-loaded'
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
  /** Servings that remain in this jar after the assigned sales. */
  retainedLeftoverServings: number
  /**
   * Finished servings that must be loaded into this physical jar before this
   * trip. Zero means the trip continues contents already present in the jar.
   */
  plannedFillServings: number
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

export interface MultiTripDiscardedInitialJuice {
  physicalJarId: string
  recipeId: string
  servings: number
}

export interface MultiTripDiscardedNewProductionJuice {
  physicalJarId: string
  recipeId: string
  recipeName: string
  servings: number
  /** 販售完成後、切換此實體罐用途前倒掉。 */
  afterTripNumber: number
}

interface PlannedNewProductionDiscard {
  recipeId: string
  recipeName: string
  servings: number
}

export interface MultiTripProductionJarFill {
  physicalJarId: string
  recipeId: string
  recipeName: string
  beforeTripNumber: number
  /** 本次由果汁成品台新增的杯數。 */
  servings: number
  /** 補裝完成後此 physical jar 內的總杯數。 */
  servingsAfterFill: number
  fillAction: 'initial-fill' | 'refill-same-type' | 'type-switch'
  previousRecipeId: string | null
  previousRecipeName: string | null
  receiver: 'carried-jar' | 'jar-rack'
}

export interface MultiTripJarCarryPolicy {
  mode: 'auto' | 'fixed-slots'
  /** fixed-slots 模式下保留的背包格數。 */
  reservedSlots: number
  /** 因果汁罐架容量不足而必須實際隨身的果汁罐數。 */
  minimumCarriedSlots: number
}

export interface CupInventoryInput {
  cleanCups: number
  usedCups: number
}

export interface MultiTripSalesTrip {
  tripNumber: number
  juiceJars: MultiTripJuiceJarLoad[]
  /** 本趟實際在玩家身上的 physical jar identities；可包含沒有販售 load 的強制隨身罐。 */
  carriedPhysicalJarIds: string[]
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
  jarCarryMode: MultiTripJarCarryPolicy['mode']
  reservedJuiceJarSlots: number
  minimumCarriedJuiceJarSlots: number
  /** 可供整日規劃使用的 physical jar 數量。 */
  carriedJuiceJarCount: number
  /** 可供整日規劃使用的 physical jars；名稱保留供既有 transaction contract 相容。 */
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
  productionJarFills: MultiTripProductionJarFill[]
  /** 是否允許規劃器在確有需要時倒掉既有果汁以釋放實體罐。 */
  allowDiscardRetainedJuice: boolean
  /** 實際被倒掉的既有果汁；未需要釋放的罐不會出現在這裡。 */
  discardedInitialJuice: MultiTripDiscardedInitialJuice[]
  /** 本次製作後、販售完仍無終局容器可保留而倒掉的殘餘。 */
  discardedNewProductionJuice: MultiTripDiscardedNewProductionJuice[]
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
  initialRecipeId: string | null
  initialServings: number
  retainedInitialRecipeId: string | null
  retainedInitialServings: number
  lockedByRetainedInitialContents: boolean
  loads: MultiTripJuiceJarLoad[]
}

function normalizeCarriedJuiceJars(
  jars: JuiceJarInventoryItem[],
): MultiTripPhysicalJar[] {
  const seen = new Set<string>()

  return jars.map((jar) => {
    if (!jar.id || seen.has(jar.id)) {
      throw new Error(
        'Available physical juice jars require unique persistent inventory IDs',
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
  shortfall: PreparationShortfall,
): RecipeJarDemand[] {
  const shortfallByRecipeId = new Map(
    shortfall.recipes.map((recipe) => [recipe.recipeId, recipe]),
  )

  return demand.recipes
    .map((recipe) => {
      const stock = shortfallByRecipeId.get(recipe.recipeId)
      if (!stock) {
        throw new Error(
          `Missing preparation shortfall for recipe ${recipe.recipeId}`,
        )
      }

      const existingServingsUsed = Math.max(
        0,
        Math.floor(stock.finishedServingsUsed),
      )
      const customerIds = recipe.customerIds.slice(existingServingsUsed)
      const servings = Math.max(
        0,
        Math.floor(recipe.assignedServings) - existingServingsUsed,
      )
      if (customerIds.length !== servings) {
        throw new Error(
          `Finished-stock customer allocation drifted for recipe ${recipe.recipeId}`,
        )
      }

      return {
        recipeId: recipe.recipeId,
        recipeName: recipe.recipeName,
        servings,
        leftoverServings: Math.max(
          0,
          Math.floor(stock.newProductionLeftoverServings),
        ),
        chunks: splitCustomerServings(customerIds, servings),
      }
    })
    .filter((recipe) => recipe.chunks.length > 0)
    .sort(
      (a, b) =>
        b.chunks.length - a.chunks.length ||
        b.servings - a.servings ||
        a.recipeName.localeCompare(b.recipeName, 'zh-Hant') ||
        a.recipeId.localeCompare(b.recipeId),
    )
}

function buildInitialJarQueues(
  demand: PreparationDemand,
  shortfall: PreparationShortfall,
  carriedJuiceJars: MultiTripPhysicalJar[],
): JarQueue[] {
  const demandByRecipeId = new Map(
    demand.recipes.map((recipe) => [recipe.recipeId, recipe]),
  )
  const sourceByJarId = new Map<
    string,
    PreparationShortfall['recipes'][number]['finishedStockSources'][number]
  >()

  for (const recipe of shortfall.recipes) {
    for (const source of recipe.finishedStockSources) {
      if (sourceByJarId.has(source.physicalJarId)) {
        throw new Error(
          `Persistent jar ${source.physicalJarId} was allocated as finished stock more than once`,
        )
      }
      sourceByJarId.set(source.physicalJarId, source)
    }
  }

  const customerCursorByRecipeId = new Map<string, number>()
  const queues = carriedJuiceJars.map((jar): JarQueue => {
    const source = sourceByJarId.get(jar.physicalJarId)
    const loads: MultiTripJuiceJarLoad[] = []

    if (source) {
      if (
        jar.initialRecipeId !== source.recipeId ||
        jar.initialServings !== source.initialServings
      ) {
        throw new Error(
          `Finished-stock source ${jar.physicalJarId} does not match its persistent initial contents`,
        )
      }

      if (source.servingsUsed > 0) {
        const recipe = demandByRecipeId.get(source.recipeId)
        if (!recipe) {
          throw new Error(
            `Finished-stock source ${jar.physicalJarId} references a recipe outside sales demand`,
          )
        }
        const cursor =
          customerCursorByRecipeId.get(source.recipeId) ?? 0
        const customerIds = recipe.customerIds.slice(
          cursor,
          cursor + source.servingsUsed,
        )
        if (customerIds.length !== source.servingsUsed) {
          throw new Error(
            `Finished-stock source ${jar.physicalJarId} exceeds assigned customers`,
          )
        }
        customerCursorByRecipeId.set(
          source.recipeId,
          cursor + source.servingsUsed,
        )

        loads.push({
          physicalJarId: jar.physicalJarId,
          recipeId: source.recipeId,
          recipeName: recipe.recipeName,
          customerIds,
          servings: source.servingsUsed,
          retainedLeftoverServings: source.servingsRemaining,
          plannedFillServings: 0,
          slotCost: JUICE_JAR_SLOT_COST,
          fillAction: 'use-existing',
          previousRecipeId: source.recipeId,
          previousRecipeName: recipe.recipeName,
        })
      }
    }

    const initialRemainingServings = source
      ? source.servingsRemaining
      : jar.initialServings

    return {
      physicalJarId: jar.physicalJarId,
      initialRecipeId: jar.initialRecipeId,
      initialServings: jar.initialServings,
      retainedInitialRecipeId:
        jar.initialRecipeId && initialRemainingServings > 0
          ? jar.initialRecipeId
          : null,
      retainedInitialServings: initialRemainingServings,
      lockedByRetainedInitialContents:
        Boolean(jar.initialRecipeId) &&
        initialRemainingServings > 0,
      loads,
    }
  })

  for (const recipe of shortfall.recipes) {
    const allocated =
      customerCursorByRecipeId.get(recipe.recipeId) ?? 0
    if (allocated !== recipe.finishedServingsUsed) {
      throw new Error(
        `Finished-stock jar sources do not sum to used servings for recipe ${recipe.recipeId}`,
      )
    }
  }

  return queues
}

function queueCurrentRecipeId(queue: JarQueue): string | null {
  const latest = queue.loads.at(-1)
  if (latest) return latest.recipeId
  return queue.initialServings > 0 ? queue.initialRecipeId : null
}

function queueSelectionSort(
  recipeId: string,
  a: JarQueue,
  b: JarQueue,
): number {
  const rank = (queue: JarQueue): number => {
    const current = queueCurrentRecipeId(queue)
    if (current === recipeId) return 0
    if (current === null) return 1
    return 2
  }

  return rank(a) - rank(b) || queueLoadSort(a, b)
}

function appendRecipeChunks(
  queue: JarQueue,
  recipe: RecipeJarDemand,
  chunks: RecipeJarChunk[],
): void {
  if (queue.lockedByRetainedInitialContents) {
    throw new Error(
      `Physical jar ${queue.physicalJarId} still contains juice that cannot be discarded or replaced`,
    )
  }

  for (const chunk of chunks) {
    const previousRecipeId = queueCurrentRecipeId(queue)
    const previous = queue.loads.at(-1)
    const previousRecipeName =
      previous?.recipeName ??
      (previousRecipeId === recipe.recipeId
        ? recipe.recipeName
        : null)
    const fillAction: JuiceJarFillAction =
      previousRecipeId === null
        ? 'initial-fill'
        : previousRecipeId === recipe.recipeId
          ? 'refill-same-type'
          : 'type-switch'

    queue.loads.push({
      physicalJarId: queue.physicalJarId,
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
      customerIds: [...chunk.customerIds],
      servings: chunk.servings,
      retainedLeftoverServings: 0,
      plannedFillServings: chunk.servings,
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
  queues: JarQueue[],
  sequencePlan: MinimumJarSwitchSequencePlan,
): JarQueue[] {
  const recipeById = new Map(
    recipes.map((recipe) => [recipe.recipeId, recipe]),
  )
  const queueById = new Map(
    queues.map((queue) => [queue.physicalJarId, queue]),
  )
  const placedRecipeIds = new Set<string>()

  for (const sequence of sequencePlan.sequences) {
    const queue = queueById.get(sequence.physicalJarId)
    if (!queue) {
      throw new Error(
        `Jar sequence references unknown physical jar ${sequence.physicalJarId}`,
      )
    }

    for (const recipeId of sequence.recipeIds) {
      const recipe = recipeById.get(recipeId)
      if (!recipe) {
        throw new Error(
          `Jar sequence references unknown recipe ${recipeId}`,
        )
      }
      if (placedRecipeIds.has(recipeId)) {
        throw new Error(
          `Jar sequence placed recipe ${recipeId} more than once`,
        )
      }

      appendRecipeChunks(queue, recipe, recipe.chunks)
      placedRecipeIds.add(recipeId)
    }
  }

  if (placedRecipeIds.size !== recipes.length) {
    throw new Error(
      'Jar sequence plan did not place every produced recipe',
    )
  }

  return queues
}

function buildJarQueuesWithoutSwitches(
  recipes: RecipeJarDemand[],
  queues: JarQueue[],
): JarQueue[] {
  const availableQueues = queues.filter(
    (queue) => !queue.lockedByRetainedInitialContents,
  )
  const pool = [...availableQueues]
  const queuesByRecipeId = new Map<string, JarQueue[]>()

  // Reserve one physical jar per recipe first. Matching existing contents are
  // preferred, then initially empty jars, then a true type switch.
  for (const recipe of recipes) {
    pool.sort((a, b) =>
      queueSelectionSort(recipe.recipeId, a, b),
    )
    const target = pool.shift()
    if (!target) {
      throw new Error(
        'Physical jar queue allocation exceeded reusable carried jar identities',
      )
    }
    queuesByRecipeId.set(recipe.recipeId, [target])
  }

  // Additional jars are only useful when they do not increase the minimum
  // switch count. A jar whose last recipe is another type would create a
  // duplicate switch for the same recipe merely to parallelize chunks.
  while (pool.length > 0) {
    const candidate = recipes
      .flatMap((recipe) => {
        const assigned = queuesByRecipeId.get(recipe.recipeId) ?? []
        if (assigned.length >= recipe.chunks.length) return []

        const compatible = pool
          .filter((queue) => {
            const current = queueCurrentRecipeId(queue)
            return current === null || current === recipe.recipeId
          })
          .sort((a, b) =>
            queueSelectionSort(recipe.recipeId, a, b),
          )
        const target = compatible[0]
        if (!target) return []

        return [{
          recipe,
          target,
          assignedCount: assigned.length,
          pressure: Math.ceil(
            recipe.chunks.length / Math.max(1, assigned.length),
          ),
        }]
      })
      .sort(
        (a, b) =>
          b.pressure - a.pressure ||
          b.recipe.chunks.length / Math.max(1, b.assignedCount) -
            a.recipe.chunks.length / Math.max(1, a.assignedCount) ||
          b.recipe.servings - a.recipe.servings ||
          a.recipe.recipeName.localeCompare(
            b.recipe.recipeName,
            'zh-Hant',
          ) ||
          a.recipe.recipeId.localeCompare(b.recipe.recipeId),
      )[0]

    if (!candidate) break

    const targetIndex = pool.indexOf(candidate.target)
    if (targetIndex < 0) {
      throw new Error(
        'Compatible physical jar disappeared during queue allocation',
      )
    }
    pool.splice(targetIndex, 1)
    const assigned =
      queuesByRecipeId.get(candidate.recipe.recipeId) ?? []
    assigned.push(candidate.target)
    queuesByRecipeId.set(candidate.recipe.recipeId, assigned)
  }

  for (const recipe of recipes) {
    const recipeQueues =
      queuesByRecipeId.get(recipe.recipeId) ?? []
    if (recipeQueues.length === 0) {
      throw new Error(
        'Recipe lost its reserved physical jar during queue allocation',
      )
    }

    recipe.chunks.forEach((chunk, index) => {
      appendRecipeChunks(
        recipeQueues[index % recipeQueues.length],
        recipe,
        [chunk],
      )
    })
  }

  return queues
}

function releaseMinimumRetainedQueues(
  recipes: RecipeJarDemand[],
  queues: JarQueue[],
  allowDiscardRetainedJuice: boolean,
): MultiTripDiscardedInitialJuice[] {
  if (!allowDiscardRetainedJuice || recipes.length === 0) {
    return []
  }

  const terminalRecipeCount = recipes.filter(
    (recipe) => recipe.leftoverServings > 0,
  ).length
  const minimumReusableQueueCount = Math.max(
    1,
    terminalRecipeCount,
  )
  const reusableQueueCount = queues.filter(
    (queue) => !queue.lockedByRetainedInitialContents,
  ).length
  const queuesToRelease = Math.max(
    0,
    minimumReusableQueueCount - reusableQueueCount,
  )
  if (queuesToRelease === 0) return []

  const candidates = queues
    .filter(
      (queue) =>
        queue.lockedByRetainedInitialContents &&
        queue.retainedInitialRecipeId &&
        queue.retainedInitialServings > 0,
    )
    .sort(
      (a, b) =>
        a.retainedInitialServings - b.retainedInitialServings ||
        a.physicalJarId.localeCompare(b.physicalJarId),
    )
    .slice(0, queuesToRelease)

  const discarded: MultiTripDiscardedInitialJuice[] = []
  for (const queue of candidates) {
    const recipeId = queue.retainedInitialRecipeId
    if (!recipeId || queue.retainedInitialServings <= 0) continue

    const latest = queue.loads.at(-1)
    if (
      latest &&
      latest.recipeId === recipeId &&
      latest.retainedLeftoverServings ===
        queue.retainedInitialServings
    ) {
      latest.retainedLeftoverServings = 0
    }

    discarded.push({
      physicalJarId: queue.physicalJarId,
      recipeId,
      servings: queue.retainedInitialServings,
    })
    queue.lockedByRetainedInitialContents = false
    queue.retainedInitialRecipeId = null
    queue.retainedInitialServings = 0
  }

  return discarded
}

function buildPhysicalJarQueues(
  recipes: RecipeJarDemand[],
  queues: JarQueue[],
  allowDiscardRetainedJuice: boolean,
): {
  queues: JarQueue[]
  discardedInitialJuice: MultiTripDiscardedInitialJuice[]
  plannedNewProductionDiscards: PlannedNewProductionDiscard[]
  expectedMinimumSwitches: number
} {
  if (recipes.length === 0) {
    return {
      queues,
      discardedInitialJuice: [],
      plannedNewProductionDiscards: [],
      expectedMinimumSwitches: 0,
    }
  }

  const discardedInitialJuice = releaseMinimumRetainedQueues(
    recipes,
    queues,
    allowDiscardRetainedJuice,
  )
  const reusableQueueCount = queues.filter(
    (queue) => !queue.lockedByRetainedInitialContents,
  ).length
  if (reusableQueueCount < 1) {
    throw new PlanningUserError(
      'retained-juice-conflict',
      {},
      'No available physical juice jar can accept newly produced juice without discarding retained contents',
    )
  }

  const terminalRecipes = recipes
    .filter((recipe) => recipe.leftoverServings > 0)
    .sort(
      (a, b) =>
        b.leftoverServings - a.leftoverServings ||
        a.recipeName.localeCompare(b.recipeName, 'zh-Hant') ||
        a.recipeId.localeCompare(b.recipeId),
    )

  const unplaceableTerminalRecipes =
    terminalRecipes.length > reusableQueueCount
      ? terminalRecipes.slice(reusableQueueCount)
      : []

  if (
    unplaceableTerminalRecipes.length > 0 &&
    !allowDiscardRetainedJuice
  ) {
    const unplaceableLeftovers =
      unplaceableTerminalRecipes.reduce(
        (sum, recipe) => sum + recipe.leftoverServings,
        0,
      )

    throw new PlanningUserError(
      'leftover-storage',
      {
        remainingServings: unplaceableLeftovers,
        requiredTerminalJarCount: terminalRecipes.length,
        reusableTerminalJarCount: reusableQueueCount,
        retainedJarCount: queues.length - reusableQueueCount,
      },
      `Terminal leftovers require ${terminalRecipes.length} reusable jars, but only ${reusableQueueCount} are available`,
    )
  }

  const plannedNewProductionDiscards =
    unplaceableTerminalRecipes.map((recipe) => ({
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
      servings: recipe.leftoverServings,
    }))
  const discardedRecipeIds = new Set(
    plannedNewProductionDiscards.map((item) => item.recipeId),
  )
  const schedulableRecipes = recipes.map((recipe) =>
    discardedRecipeIds.has(recipe.recipeId)
      ? { ...recipe, leftoverServings: 0 }
      : recipe,
  )

  const reusableQueues = queues.filter(
    (queue) => !queue.lockedByRetainedInitialContents,
  )
  const sequencePlan = planMinimumJarTypeSwitchSequences(
    reusableQueues.map((queue) => ({
      physicalJarId: queue.physicalJarId,
      currentRecipeId: queueCurrentRecipeId(queue),
    })),
    schedulableRecipes.map((recipe) => recipe.recipeId),
    schedulableRecipes
      .filter((recipe) => recipe.leftoverServings > 0)
      .map((recipe) => recipe.recipeId),
  )

  const builtQueues =
    schedulableRecipes.length > reusableQueueCount
      ? buildJarQueuesWithSwitches(
          schedulableRecipes,
          queues,
          sequencePlan,
        )
      : buildJarQueuesWithoutSwitches(schedulableRecipes, queues)

  return {
    queues: builtQueues,
    discardedInitialJuice,
    plannedNewProductionDiscards,
    expectedMinimumSwitches: sequencePlan.minimumSwitches,
  }
}

function assignNewProductionLeftovers(
  shortfall: PreparationShortfall,
  queues: JarQueue[],
  plannedDiscards: readonly PlannedNewProductionDiscard[] = [],
): Array<Omit<MultiTripDiscardedNewProductionJuice, 'afterTripNumber'>> {
  const discardByRecipeId = new Map(
    plannedDiscards.map((item) => [item.recipeId, item]),
  )
  const discarded: Array<
    Omit<MultiTripDiscardedNewProductionJuice, 'afterTripNumber'>
  > = []

  for (const recipe of shortfall.recipes) {
    const totalLeftover = Math.max(
      0,
      Math.floor(recipe.newProductionLeftoverServings),
    )
    if (totalLeftover === 0) continue

    const plannedDiscard = discardByRecipeId.get(recipe.recipeId)
    const discardServings = Math.min(
      totalLeftover,
      Math.max(0, Math.floor(plannedDiscard?.servings ?? 0)),
    )
    let remainingToRetain = totalLeftover - discardServings
    let remainingToDiscard = discardServings

    const candidates = queues
      .flatMap((queue) => {
        const load = [...queue.loads]
          .reverse()
          .find(
            (item) =>
              item.recipeId === recipe.recipeId &&
              item.plannedFillServings > 0,
          )
        return load ? [{ queue, load }] : []
      })
      .sort(
        (a, b) =>
          b.load.servings - a.load.servings ||
          a.queue.physicalJarId.localeCompare(
            b.queue.physicalJarId,
          ),
      )

    for (const candidate of candidates) {
      if (remainingToRetain <= 0) break
      const freeCapacity =
        JUICE_JAR_CAPACITY - candidate.load.plannedFillServings
      const retained = Math.min(remainingToRetain, freeCapacity)
      if (retained <= 0) continue

      candidate.load.retainedLeftoverServings += retained
      candidate.load.plannedFillServings += retained
      remainingToRetain -= retained
    }

    if (remainingToRetain > 0) {
      const reusableTerminalJarCount = queues.filter(
        (queue) => !queue.lockedByRetainedInitialContents,
      ).length
      const requiredTerminalJarCount = shortfall.recipes.filter(
        (item) => item.newProductionLeftoverServings > 0,
      ).length

      throw new PlanningUserError(
        'leftover-storage',
        {
          remainingServings: remainingToRetain,
          requiredTerminalJarCount,
          reusableTerminalJarCount,
          retainedJarCount:
            queues.length - reusableTerminalJarCount,
        },
        `Not enough terminal sales-jar capacity to preserve ${remainingToRetain} leftover serving(s) without switching away from retained juice`,
      )
    }

    for (const candidate of candidates) {
      if (remainingToDiscard <= 0) break
      const freeCapacity =
        JUICE_JAR_CAPACITY - candidate.load.plannedFillServings
      const toDiscard = Math.min(
        remainingToDiscard,
        freeCapacity,
      )
      if (toDiscard <= 0) continue

      candidate.load.plannedFillServings += toDiscard
      discarded.push({
        physicalJarId: candidate.queue.physicalJarId,
        recipeId: recipe.recipeId,
        recipeName: recipe.recipeName,
        servings: toDiscard,
      })
      remainingToDiscard -= toDiscard
    }

    if (remainingToDiscard > 0) {
      throw new Error(
        `New-production discard for ${recipe.recipeId} could not be attached to its physical production jar`,
      )
    }
  }

  return discarded
}

function resolveNewProductionDiscardTrips(
  discards: readonly Omit<
    MultiTripDiscardedNewProductionJuice,
    'afterTripNumber'
  >[],
  trips: readonly MultiTripSalesTrip[],
): MultiTripDiscardedNewProductionJuice[] {
  return discards.map((discard) => {
    const matchingTrips = trips.filter((trip) =>
      trip.juiceJars.some(
        (load) =>
          load.physicalJarId === discard.physicalJarId &&
          load.recipeId === discard.recipeId,
      ),
    )
    const afterTripNumber = matchingTrips.at(-1)?.tripNumber
    if (!afterTripNumber) {
      throw new Error(
        `New-production discard for ${discard.recipeId} has no matching sales trip`,
      )
    }

    return {
      ...discard,
      afterTripNumber,
    }
  })
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
  carriedPhysicalJarIds: string[]
  juiceJarSlotsCarried: number
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

function cloneJarQueues(queues: JarQueue[]): JarQueue[] {
  return queues.map((queue) => ({
    ...queue,
    loads: queue.loads.map((load) => ({
      ...load,
      customerIds: [...load.customerIds],
    })),
  }))
}

function coalesceInitialSameRecipeRefills(
  queues: JarQueue[],
): number {
  let coalescedLoadCount = 0

  for (const queue of queues) {
    const existing = queue.loads[0]
    const refill = queue.loads[1]

    if (
      !existing ||
      !refill ||
      existing.fillAction !== 'use-existing' ||
      existing.plannedFillServings !== 0 ||
      existing.retainedLeftoverServings !== 0 ||
      refill.fillAction !== 'refill-same-type' ||
      existing.recipeId !== refill.recipeId ||
      existing.physicalJarId !== refill.physicalJarId ||
      existing.servings + refill.plannedFillServings >
        JUICE_JAR_CAPACITY
    ) {
      continue
    }

    queue.loads.splice(0, 2, {
      ...refill,
      customerIds: [
        ...existing.customerIds,
        ...refill.customerIds,
      ],
      servings: existing.servings + refill.servings,
      fillAction: 'refill-same-type',
      previousRecipeId: existing.recipeId,
      previousRecipeName: existing.recipeName,
    })
    coalescedLoadCount += 1
  }

  return coalescedLoadCount
}

type TripCandidateOrderMode =
  | 'baseline'
  | 'terminal-leftovers-last'

function buildTrips(
  queues: JarQueue[],
  policy: UsedCupTripPolicy,
  carryPolicy: MultiTripJarCarryPolicy,
  initialCupState: CupState,
  orderMode: TripCandidateOrderMode = 'baseline',
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
  const allPhysicalJarIds = queues.map((queue) => queue.physicalJarId)
  const minimumCarriedSlots = Math.max(
    0,
    Math.floor(carryPolicy.minimumCarriedSlots),
  )
  const reservedSlots = Math.max(
    0,
    Math.min(
      BACKPACK_SLOT_CAPACITY,
      Math.floor(carryPolicy.reservedSlots),
    ),
  )
  if (minimumCarriedSlots > BACKPACK_SLOT_CAPACITY) {
    throw new PlanningUserError(
      'jar-storage-overflow',
      {},
      'Owned physical juice jars exceed combined jar-rack and backpack capacity',
    )
  }

  const fixedSlotCost = Math.max(
    minimumCarriedSlots,
    reservedSlots,
  )
  const maxConcurrentJars =
    carryPolicy.mode === 'fixed-slots'
      ? Math.min(queues.length, fixedSlotCost)
      : Math.min(queues.length, BACKPACK_SLOT_CAPACITY)

  const jarSlotsFor = (activeJarCount: number): number =>
    carryPolicy.mode === 'fixed-slots'
      ? fixedSlotCost
      : Math.max(minimumCarriedSlots, activeJarCount)

  const carriedIdsFor = (activeIds: string[]): string[] => {
    const carried = [...activeIds]
    const requiredPhysicalCount = Math.max(
      minimumCarriedSlots,
      activeIds.length,
    )
    if (carried.length >= requiredPhysicalCount) return carried

    const activeSet = new Set(activeIds)
    for (const physicalJarId of allPhysicalJarIds) {
      if (activeSet.has(physicalJarId)) continue
      carried.push(physicalJarId)
      if (carried.length >= requiredPhysicalCount) break
    }
    return carried
  }

  let cupState: CupState = {
    cleanCups: normalizedCupCount(initialCupState.cleanCups),
    usedCups: normalizedCupCount(initialCupState.usedCups),
  }

  while (pending.some((queue) => queue.loads.length > 0)) {
    const candidates = pending
      .flatMap((queue) =>
        queue.loads[0] ? [queue.loads[0]] : [],
      )
      .sort((a, b) => {
        const terminalTimingPreference =
          orderMode === 'terminal-leftovers-last'
            ? Number(a.retainedLeftoverServings > 0) -
              Number(b.retainedLeftoverServings > 0)
            : 0

        return (
          terminalTimingPreference ||
          b.servings - a.servings ||
          a.recipeName.localeCompare(
            b.recipeName,
            'zh-Hant',
          ) ||
          a.recipeId.localeCompare(b.recipeId) ||
          a.physicalJarId.localeCompare(b.physicalJarId)
        )
      })

    const trip = {
      juiceJars: [] as MultiTripJuiceJarLoad[],
      totalServings: 0,
    }
    const selectedServingsByJarId = new Map<string, number>()

    for (const jar of candidates) {
      if (trip.juiceJars.length >= maxConcurrentJars) continue

      const proposedJarSlots = jarSlotsFor(
        trip.juiceJars.length + 1,
      )
      if (proposedJarSlots > BACKPACK_SLOT_CAPACITY) continue

      // A production fill / prepared jar content identity stays atomic, but
      // sales consumption may span trips. Preserve a complete load whenever
      // it can fit on its own later trip; split only when the load itself is
      // impossible under the current physical cup lifecycle.
      const fullTransition = simulateCupTrip(
        cupState,
        trip.totalServings + jar.servings,
        policy,
        proposedJarSlots,
      )

      let servingsForTrip = jar.servings
      if (!fullTransition) {
        const fullLoadFitsAlone = simulateCupTrip(
          cupState,
          jar.servings,
          policy,
          jarSlotsFor(1),
        )
        if (fullLoadFitsAlone) continue

        servingsForTrip = 0
        for (
          let partialServings = jar.servings - 1;
          partialServings > 0;
          partialServings -= 1
        ) {
          const partialTransition = simulateCupTrip(
            cupState,
            trip.totalServings + partialServings,
            policy,
            proposedJarSlots,
          )
          if (!partialTransition) continue

          servingsForTrip = partialServings
          break
        }
        if (servingsForTrip === 0) continue
      }

      const unsoldServings = jar.servings - servingsForTrip
      trip.juiceJars.push({
        ...jar,
        customerIds: jar.customerIds.slice(0, servingsForTrip),
        servings: servingsForTrip,
        retainedLeftoverServings:
          jar.retainedLeftoverServings + unsoldServings,
      })
      trip.totalServings += servingsForTrip
      selectedServingsByJarId.set(
        jar.physicalJarId,
        servingsForTrip,
      )
    }

    if (trip.juiceJars.length === 0) {
      if (cupState.cleanCups + cupState.usedCups < 1) {
        throw new PlanningUserError(
          'missing-physical-cup',
          {},
          'Sales planning requires at least one physical cup',
        )
      }
      if (maxConcurrentJars < 1) {
        throw new PlanningUserError(
          'missing-jar-slot',
          {},
          'Sales planning requires at least one usable juice-jar slot',
        )
      }
      throw new PlanningUserError(
        'trip-capacity',
        { policy },
        `No remaining sales load can fit the ${policy} trip policy with the current cups and backpack slots`,
      )
    }

    const juiceJarSlotsCarried = jarSlotsFor(
      trip.juiceJars.length,
    )
    const carriedPhysicalJarIds = carriedIdsFor(
      trip.juiceJars.map((load) => load.physicalJarId),
    )
    const cupTransition = simulateCupTrip(
      cupState,
      trip.totalServings,
      policy,
      juiceJarSlotsCarried,
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

      queue.loads[0] = {
        ...head,
        customerIds: head.customerIds.slice(served),
        servings: head.servings - served,
        plannedFillServings: 0,
        fillAction: 'continue-loaded',
        previousRecipeId: head.recipeId,
        previousRecipeName: head.recipeName,
      }
    }

    trips.push({
      ...trip,
      carriedPhysicalJarIds,
      juiceJarSlotsCarried,
      cupTransition,
    })
  }

  return {
    trips,
    finalCupState: cupState,
  }
}

export interface TerminalLeftoverScheduleMetrics {
  feasible: boolean
  tripCount: number
  droppedUsedCups: number
  discardedJuiceServings: number
  cupWashWaterUnits: number
  jarTypeSwitches: number
  physicalJarSequenceSignature: string
  terminalLeftoverTripScore: number
}

export function shouldAcceptTerminalLeftoverTimingCandidate(
  baseline: TerminalLeftoverScheduleMetrics,
  candidate: TerminalLeftoverScheduleMetrics,
): boolean {
  return (
    candidate.feasible &&
    candidate.tripCount === baseline.tripCount &&
    candidate.droppedUsedCups === baseline.droppedUsedCups &&
    candidate.discardedJuiceServings === baseline.discardedJuiceServings &&
    candidate.cupWashWaterUnits === baseline.cupWashWaterUnits &&
    candidate.jarTypeSwitches === baseline.jarTypeSwitches &&
    candidate.physicalJarSequenceSignature ===
      baseline.physicalJarSequenceSignature &&
    candidate.terminalLeftoverTripScore >
      baseline.terminalLeftoverTripScore
  )
}

function shouldAcceptSameRecipePrefillCandidate(
  baseline: TerminalLeftoverScheduleMetrics,
  candidate: TerminalLeftoverScheduleMetrics,
): boolean {
  return (
    candidate.feasible &&
    candidate.tripCount < baseline.tripCount &&
    candidate.droppedUsedCups <= baseline.droppedUsedCups &&
    candidate.discardedJuiceServings ===
      baseline.discardedJuiceServings &&
    candidate.cupWashWaterUnits <= baseline.cupWashWaterUnits &&
    candidate.jarTypeSwitches === baseline.jarTypeSwitches
  )
}

function mutableTripSequenceSignature(
  trips: readonly MutableTrip[],
): string {
  const byJarId = new Map<string, string[]>()

  for (const trip of trips) {
    for (const load of trip.juiceJars) {
      const sequence = byJarId.get(load.physicalJarId) ?? []
      sequence.push(
        [
          load.recipeId,
          load.fillAction,
          load.servings,
          load.plannedFillServings,
          load.retainedLeftoverServings,
        ].join(':'),
      )
      byJarId.set(load.physicalJarId, sequence)
    }
  }

  return [...byJarId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([physicalJarId, sequence]) =>
      physicalJarId + '=' + sequence.join('>'),
    )
    .join('|')
}

function terminalLeftoverScheduleMetrics(
  trips: readonly MutableTrip[],
  discardedJuiceServings: number,
): TerminalLeftoverScheduleMetrics {
  const finalJarStateById = new Map<
    string,
    { retainedLeftoverServings: number; tripIndex: number }
  >()

  trips.forEach((trip, index) => {
    for (const load of trip.juiceJars) {
      finalJarStateById.set(load.physicalJarId, {
        retainedLeftoverServings:
          load.retainedLeftoverServings,
        tripIndex: index,
      })
    }
  })

  return {
    feasible: true,
    tripCount: trips.length,
    droppedUsedCups: trips.reduce(
      (sum, trip) => sum + trip.cupTransition.droppedUsedCups,
      0,
    ),
    discardedJuiceServings,
    cupWashWaterUnits: trips.reduce(
      (sum, trip) => sum + trip.cupTransition.cupsWashedBeforeTrip,
      0,
    ),
    jarTypeSwitches: trips.reduce(
      (sum, trip) =>
        sum +
        trip.juiceJars.filter(
          (load) => load.fillAction === 'type-switch',
        ).length,
      0,
    ),
    physicalJarSequenceSignature:
      mutableTripSequenceSignature(trips),
    terminalLeftoverTripScore: [
      ...finalJarStateById.values(),
    ].reduce(
      (score, state) =>
        score +
        (state.retainedLeftoverServings > 0
          ? state.tripIndex + 1
          : 0),
      0,
    ),
  }
}

function allocateLeftoverJarContents(
  shortfall: PreparationShortfall,
  trips: MultiTripSalesTrip[],
  discardedInitialJuice: readonly MultiTripDiscardedInitialJuice[] = [],
  discardedNewProductionJuice: readonly MultiTripDiscardedNewProductionJuice[] = [],
): MultiTripLeftoverJarContent[] {
  const finalContentsByJarId = new Map<
    string,
    MultiTripLeftoverJarContent
  >()

  for (const trip of trips) {
    for (const load of trip.juiceJars) {
      finalContentsByJarId.set(load.physicalJarId, {
        physicalJarId: load.physicalJarId,
        recipeId: load.recipeId,
        recipeName: load.recipeName,
        servings: load.retainedLeftoverServings,
        tripNumber: trip.tripNumber,
      })
    }
  }

  const contents = [...finalContentsByJarId.values()]
    .filter((item) => item.servings > 0)
    .sort(
      (a, b) =>
        a.physicalJarId.localeCompare(b.physicalJarId) ||
        a.recipeName.localeCompare(b.recipeName, 'zh-Hant') ||
        a.recipeId.localeCompare(b.recipeId),
    )

  const discardedByJarId = new Map(
    discardedInitialJuice.map((item) => [
      item.physicalJarId,
      item.servings,
    ]),
  )
  const discardedNewByRecipeId = new Map<string, number>()
  for (const item of discardedNewProductionJuice) {
    discardedNewByRecipeId.set(
      item.recipeId,
      (discardedNewByRecipeId.get(item.recipeId) ?? 0) +
        item.servings,
    )
  }
  const expectedLeftovers = shortfall.recipes.reduce(
    (sum, recipe) =>
      sum +
      Math.max(
        0,
        recipe.newProductionLeftoverServings -
          (discardedNewByRecipeId.get(recipe.recipeId) ?? 0),
      ) +
      recipe.finishedStockSources.reduce(
        (sourceSum, source) =>
          sourceSum +
          (source.servingsUsed > 0
            ? Math.max(
                0,
                source.servingsRemaining -
                  (discardedByJarId.get(source.physicalJarId) ?? 0),
              )
            : 0),
        0,
      ),
    0,
  )
  const actualLeftovers = contents.reduce(
    (sum, item) => sum + item.servings,
    0,
  )

  if (actualLeftovers !== expectedLeftovers) {
    throw new Error(
      `Physical jar leftover timeline drifted: expected ${expectedLeftovers}, got ${actualLeftovers}`,
    )
  }

  return contents
}

export function buildProductionJarFillsFromSchedule(
  trips: MultiTripSalesTrip[],
  initialJars: MultiTripPhysicalJar[] = [],
  discardedInitialJuice: readonly MultiTripDiscardedInitialJuice[] = [],
  discardedNewProductionJuice: readonly MultiTripDiscardedNewProductionJuice[] = [],
): MultiTripProductionJarFill[] {
  const jarState = new Map<
    string,
    {
      currentRecipeId: string | null
      lastRecipeId: string | null
      servings: number
    }
  >()

  const discardedByJarId = new Map(
    discardedInitialJuice.map((item) => [
      item.physicalJarId,
      item.servings,
    ]),
  )
  for (const jar of initialJars) {
    const initialServings = Math.max(
      0,
      Math.floor(jar.initialServings),
    )
    const discardedServings = Math.min(
      initialServings,
      discardedByJarId.get(jar.physicalJarId) ?? 0,
    )
    const effectiveInitialServings =
      initialServings - discardedServings

    jarState.set(jar.physicalJarId, {
      currentRecipeId:
        jar.initialRecipeId && effectiveInitialServings > 0
          ? jar.initialRecipeId
          : null,
      lastRecipeId:
        jar.initialRecipeId && initialServings > 0
          ? jar.initialRecipeId
          : null,
      servings: effectiveInitialServings,
    })
  }

  const fills: MultiTripProductionJarFill[] = []

  for (const trip of trips) {
    for (const load of trip.juiceJars) {
      const state = jarState.get(load.physicalJarId)
      if (!state) {
        throw new Error(
          `Sales schedule references unknown physical jar ${load.physicalJarId}`,
        )
      }

      if (load.plannedFillServings > 0) {
        if (
          load.fillAction === 'use-existing' ||
          load.fillAction === 'continue-loaded'
        ) {
          throw new Error(
            `Jar ${load.physicalJarId} cannot load newly produced juice with action ${load.fillAction}`,
          )
        }
        if (
          state.servings > 0 &&
          state.currentRecipeId !== load.recipeId
        ) {
          throw new Error(
            `Jar ${load.physicalJarId} still contains a different recipe before trip ${trip.tripNumber}`,
          )
        }

        const expectedAction: MultiTripProductionJarFill['fillAction'] =
          state.lastRecipeId === null
            ? 'initial-fill'
            : state.lastRecipeId === load.recipeId
              ? 'refill-same-type'
              : 'type-switch'

        if (load.fillAction !== expectedAction) {
          throw new Error(
            `Jar ${load.physicalJarId} has inconsistent production fill action before trip ${trip.tripNumber}`,
          )
        }
        if (
          state.servings + load.plannedFillServings >
          JUICE_JAR_CAPACITY
        ) {
          throw new Error(
            `Physical jar ${load.physicalJarId} exceeds juice capacity before trip ${trip.tripNumber}`,
          )
        }

        fills.push({
          physicalJarId: load.physicalJarId,
          recipeId: load.recipeId,
          recipeName: load.recipeName,
          beforeTripNumber: trip.tripNumber,
          servings: load.plannedFillServings,
          servingsAfterFill:
            state.servings + load.plannedFillServings,
          fillAction: load.fillAction,
          previousRecipeId: load.previousRecipeId,
          previousRecipeName: load.previousRecipeName,
          receiver: trip.carriedPhysicalJarIds.includes(
            load.physicalJarId,
          )
            ? 'carried-jar'
            : 'jar-rack',
        })
        state.currentRecipeId = load.recipeId
        state.lastRecipeId = load.recipeId
        state.servings += load.plannedFillServings
      } else {
        if (
          load.fillAction !== 'use-existing' &&
          load.fillAction !== 'continue-loaded'
        ) {
          throw new Error(
            `Jar ${load.physicalJarId} declares ${load.fillAction} without a production fill before trip ${trip.tripNumber}`,
          )
        }
      }

      if (
        state.currentRecipeId !== load.recipeId ||
        state.servings < load.servings
      ) {
        throw new Error(
          `Jar ${load.physicalJarId} does not contain enough ${load.recipeId} for trip ${trip.tripNumber}`,
        )
      }

      state.servings -= load.servings
      if (state.servings === 0) {
        state.currentRecipeId = null
      }

      if (
        load.retainedLeftoverServings > 0 &&
        state.servings !== load.retainedLeftoverServings
      ) {
        throw new Error(
          `Jar ${load.physicalJarId} retained-leftover state drifted after trip ${trip.tripNumber}`,
        )
      }
    }

    for (const discarded of discardedNewProductionJuice.filter(
      (item) => item.afterTripNumber === trip.tripNumber,
    )) {
      const state = jarState.get(discarded.physicalJarId)
      if (!state) {
        throw new Error(
          `New-production discard references unknown physical jar ${discarded.physicalJarId}`,
        )
      }
      if (
        state.currentRecipeId !== discarded.recipeId ||
        state.servings < discarded.servings
      ) {
        throw new Error(
          `New-production discard does not match jar ${discarded.physicalJarId} after trip ${trip.tripNumber}`,
        )
      }

      state.servings -= discarded.servings
      if (state.servings === 0) {
        state.currentRecipeId = null
      }
    }
  }

  return fills
}

export function countJarTypeSwitchesFromSchedule(
  trips: MultiTripSalesTrip[],
  initialJars: MultiTripPhysicalJar[] = [],
): number {
  const lastRecipeByJar = new Map<string, string>()
  for (const jar of initialJars) {
    if (jar.initialRecipeId && jar.initialServings > 0) {
      lastRecipeByJar.set(
        jar.physicalJarId,
        jar.initialRecipeId,
      )
    }
  }

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
      let expectedAction: JuiceJarFillAction

      if (load.fillAction === 'use-existing') {
        if (previousRecipeId !== load.recipeId) {
          throw new Error(
            `Jar ${load.physicalJarId} cannot use existing contents as recipe ${load.recipeId}`,
          )
        }
        expectedAction = 'use-existing'
      } else if (load.fillAction === 'continue-loaded') {
        if (previousRecipeId !== load.recipeId) {
          throw new Error(
            `Jar ${load.physicalJarId} cannot continue loaded contents as recipe ${load.recipeId}`,
          )
        }
        expectedAction = 'continue-loaded'
      } else {
        expectedAction =
          previousRecipeId === undefined
            ? 'initial-fill'
            : previousRecipeId === load.recipeId
              ? 'refill-same-type'
              : 'type-switch'
      }

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
  availableJuiceJarInventory: JuiceJarInventoryItem[],
  cups: CupInventoryInput,
  shortfall: PreparationShortfall,
  carryPolicy?: MultiTripJarCarryPolicy,
  allowDiscardRetainedJuice = false,
): MultiTripReplenishmentPlan {
  const carriedJuiceJars =
    normalizeCarriedJuiceJars(availableJuiceJarInventory)
  const normalizedJarCount = carriedJuiceJars.length
  const normalizedCarryPolicy: MultiTripJarCarryPolicy =
    carryPolicy ?? {
      mode: 'fixed-slots',
      reservedSlots: normalizedJarCount,
      minimumCarriedSlots: normalizedJarCount,
    }
  const initialCupState: CupState = {
    cleanCups: normalizedCupCount(cups.cleanCups),
    usedCups: normalizedCupCount(cups.usedCups),
  }
  const salesRecipes = demand.recipes.filter(
    (recipe) => recipe.assignedServings > 0,
  )
  const recipes = recipeJarDemands(demand, shortfall)

  if (salesRecipes.length > 0 && normalizedJarCount < 1) {
    throw new PlanningUserError(
      'missing-physical-jar',
      {},
      'Sales planning requires at least one physical juice jar',
    )
  }
  if (
    salesRecipes.length > 0 &&
    initialCupState.cleanCups + initialCupState.usedCups < 1
  ) {
    throw new PlanningUserError(
      'missing-physical-cup',
      {},
      'Sales planning requires at least one physical cup',
    )
  }

  const initialQueues = buildInitialJarQueues(
    demand,
    shortfall,
    carriedJuiceJars,
  )
  const queueBuild = buildPhysicalJarQueues(
    recipes,
    initialQueues,
    allowDiscardRetainedJuice,
  )
  const queues = queueBuild.queues
  const discardedInitialJuice =
    queueBuild.discardedInitialJuice
  const pendingNewProductionDiscards =
    assignNewProductionLeftovers(
      shortfall,
      queues,
      queueBuild.plannedNewProductionDiscards,
    )
  const discardedJuiceServings =
    discardedInitialJuice.reduce(
      (sum, item) => sum + item.servings,
      0,
    ) +
    pendingNewProductionDiscards.reduce(
      (sum, item) => sum + item.servings,
      0,
    )
  const baselineTripBuild = buildTrips(
    queues,
    policy,
    normalizedCarryPolicy,
    initialCupState,
  )
  let selectedQueues = queues
  let selectedTripBuild = baselineTripBuild

  const prefillQueues = cloneJarQueues(queues)
  const coalescedLoadCount =
    coalesceInitialSameRecipeRefills(prefillQueues)
  if (coalescedLoadCount > 0) {
    try {
      const prefillCandidate = buildTrips(
        prefillQueues,
        policy,
        normalizedCarryPolicy,
        initialCupState,
      )
      if (
        shouldAcceptSameRecipePrefillCandidate(
          terminalLeftoverScheduleMetrics(
            baselineTripBuild.trips,
            discardedJuiceServings,
          ),
          terminalLeftoverScheduleMetrics(
            prefillCandidate.trips,
            discardedJuiceServings,
          ),
        )
      ) {
        selectedQueues = prefillQueues
        selectedTripBuild = prefillCandidate
      }
    } catch (error) {
      if (!(error instanceof PlanningUserError)) {
        throw error
      }
    }
  }

  try {
    const timingCandidate = buildTrips(
      selectedQueues,
      policy,
      normalizedCarryPolicy,
      initialCupState,
      'terminal-leftovers-last',
    )
    const baselineMetrics = terminalLeftoverScheduleMetrics(
      selectedTripBuild.trips,
      discardedJuiceServings,
    )
    const candidateMetrics = terminalLeftoverScheduleMetrics(
      timingCandidate.trips,
      discardedJuiceServings,
    )

    if (
      shouldAcceptTerminalLeftoverTimingCandidate(
        baselineMetrics,
        candidateMetrics,
      )
    ) {
      selectedTripBuild = timingCandidate
    }
  } catch (error) {
    if (!(error instanceof PlanningUserError)) {
      throw error
    }
  }

  const {
    trips: mutableTrips,
    finalCupState,
  } = selectedTripBuild
  const trips: MultiTripSalesTrip[] = mutableTrips.map(
    (trip, index) => {
      const transition = trip.cupTransition
      const cleanCupStacks = transition.departureCupSlots
      const departureSlots =
        trip.juiceJarSlotsCarried + cleanCupStacks

      return {
        tripNumber: index + 1,
        juiceJars: trip.juiceJars,
        carriedPhysicalJarIds: trip.carriedPhysicalJarIds,
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
          trip.juiceJarSlotsCarried + transition.peakCupSlots,
        juiceJarSlotsCarried: trip.juiceJarSlotsCarried,
      }
    },
  )
  const discardedNewProductionJuice =
    resolveNewProductionDiscardTrips(
      pendingNewProductionDiscards,
      trips,
    )
  const leftoverJarContents = allocateLeftoverJarContents(
    shortfall,
    trips,
    discardedInitialJuice,
    discardedNewProductionJuice,
  )
  const productionJarFills =
    buildProductionJarFillsFromSchedule(
      trips,
      carriedJuiceJars,
      discardedInitialJuice,
      discardedNewProductionJuice,
    )
  const expectedProducedServings = shortfall.recipes.reduce(
    (sum, recipe) => sum + recipe.newlyProducedServings,
    0,
  )
  const scheduledProducedServings = productionJarFills.reduce(
    (sum, fill) => sum + fill.servings,
    0,
  )
  if (scheduledProducedServings !== expectedProducedServings) {
    throw new Error(
      `Production jar fills drifted: expected ${expectedProducedServings}, got ${scheduledProducedServings}`,
    )
  }
  const totalLeftoverServings = leftoverJarContents.reduce(
    (sum, item) => sum + item.servings,
    0,
  )
  const jarTypeSwitches =
    countJarTypeSwitchesFromSchedule(trips, carriedJuiceJars)
  const expectedMinimumSwitches =
    queueBuild.expectedMinimumSwitches

  if (jarTypeSwitches !== expectedMinimumSwitches) {
    throw new PlanningUserError(
      'jar-schedule-inconsistency',
      {
        expectedJarTypeSwitches: expectedMinimumSwitches,
        actualJarTypeSwitches: jarTypeSwitches,
      },
      `Physical jar schedule realized ${jarTypeSwitches} switch(es), expected the terminal-aware physical minimum ${expectedMinimumSwitches}`,
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
    jarCarryMode: normalizedCarryPolicy.mode,
    reservedJuiceJarSlots:
      normalizedCarryPolicy.mode === 'fixed-slots'
        ? Math.max(
            normalizedCarryPolicy.minimumCarriedSlots,
            normalizedCarryPolicy.reservedSlots,
          )
        : 0,
    minimumCarriedJuiceJarSlots:
      normalizedCarryPolicy.minimumCarriedSlots,
    carriedJuiceJarCount: normalizedJarCount,
    carriedJuiceJars,
    physicalJarsUsed: physicalJarIdsUsed.size,
    totalJarLoads,
    distinctFinalJuiceTypes: salesRecipes.length,
    jarTypeSwitches,
    trips,
    tripCount: trips.length,
    totalAssignedServings,
    totalLeftoverServings,
    leftoverJarContents,
    productionJarFills,
    allowDiscardRetainedJuice,
    discardedInitialJuice,
    discardedNewProductionJuice,
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
