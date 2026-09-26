import { ingredients } from '../data/ingredients'
import {
  recipeIngredientCapabilities,
  type RecipeIngredientCapability,
} from '../data/recipeIngredientCapabilities'
import type { IntermediateJuiceInventory, RecipeCandidate } from '../types'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { ingredientIdsFromJuiceStateIdentity } from './juiceStateIdentity'

export type ProductionStepKind =
  | 'juicing'
  | 'seasoning'
  | 'blending'
  | 'finalizing'

export interface ProductionPathEdge {
  key: string
  kind: ProductionStepKind
  equipment:
    | '柑橘榨汁機'
    | '榨汁機'
    | '調味器'
    | '果汁調和器'
    | '果汁成品台'
  fromIngredientIds: string[]
  /** Blender 的第二個果汁 input；其他 step 不使用。 */
  secondaryFromIngredientIds?: string[]
  toIngredientIds: string[]
  addedIngredientId?: string
}

export interface RecipeProductionPath {
  ingredientIds: string[]
  edges: ProductionPathEdge[]
}

export interface ProductionRecipeInput {
  recipeId: string
  recipeName: string
  ingredientIds: string[]
  juiceUnits: number
  assignedServings: number
}

export interface ProductionStep extends ProductionPathEdge {
  quantity: number
  operationCount: number
  recipeIds: string[]
}

export interface MachineOperationSummary {
  total: number
  juicing: number
  seasoning: number
  finalizing: number
  blending: number
}

export interface ProductionPlan {
  steps: ProductionStep[]
  machineOperations: MachineOperationSummary
  /**
   * Newly produced juice units from each step that are already recipe-complete
   * and go directly to finalizing. Existing intermediate stock is excluded.
   */
  readyForFinalizingUnitsByStepKey?: Record<string, number>
  /** Raw seasoning materials required by the executable production plan. */
  seasoningIngredientUnits?: Record<string, number>
  /**
   * Single-ingredient juice inputs that must be available when seasoning starts.
   * Multi-ingredient intermediates are intentionally excluded.
   */
  seasoningBaseJuiceUnits?: Record<string, number>
}

export interface IntermediateJuiceStockUsage {
  identity: string
  ingredientIds: string[]
  availableUnits: number
  usedUnits: number
  remainingUnits: number
}

export interface StockOffsetRecipeUnitUsage {
  ingredientUnits: Record<string, number>
  intermediateStockUnits: Record<string, number>
}

export interface StockOffsetRecipeUsage {
  recipeId: string
  ingredientUnits: Record<string, number>
  intermediateStockUnits: Record<string, number>
  units: StockOffsetRecipeUnitUsage[]
}

export interface StockOffsetProductionPlan extends ProductionPlan {
  intermediateStockUsage: IntermediateJuiceStockUsage[]
  recipeUsage: StockOffsetRecipeUsage[]
}

const ingredientIdByName = new Map(
  ingredients.map((ingredient) => [ingredient.name, ingredient.id]),
)

const capabilityByIngredientId = new Map<
  string,
  RecipeIngredientCapability
>(
  recipeIngredientCapabilities.map((capability) => [
    capability.ingredientId,
    capability,
  ]),
)

function sequenceKey(ids: readonly string[]): string {
  return ids.join('>')
}

function seasoningIngredientUnitsForSteps(
  steps: readonly ProductionStep[],
): Record<string, number> {
  const units: Record<string, number> = {}

  for (const step of steps) {
    if (step.kind !== 'seasoning' || !step.addedIngredientId) continue
    units[step.addedIngredientId] =
      (units[step.addedIngredientId] ?? 0) + step.quantity
  }

  return units
}

function seasoningBaseJuiceUnitsForSteps(
  steps: readonly ProductionStep[],
): Record<string, number> {
  const units: Record<string, number> = {}

  for (const step of steps) {
    if (
      step.kind !== 'seasoning' ||
      step.fromIngredientIds.length !== 1
    ) {
      continue
    }

    const ingredientId = step.fromIngredientIds[0]
    units[ingredientId] =
      (units[ingredientId] ?? 0) + step.quantity
  }

  return units
}

function readyForFinalizingUnitsForFullPlan(
  steps: readonly ProductionStep[],
): Record<string, number> {
  const producerByNode = new Map<string, ProductionStep>()

  for (const step of steps) {
    if (step.kind === 'finalizing') continue
    producerByNode.set(sequenceKey(step.toIngredientIds), step)
  }

  const result: Record<string, number> = {}
  for (const finalizer of steps) {
    if (finalizer.kind !== 'finalizing') continue
    const producer = producerByNode.get(
      sequenceKey(finalizer.fromIngredientIds),
    )
    if (!producer) continue
    result[producer.key] =
      (result[producer.key] ?? 0) + finalizer.quantity
  }

  return result
}

export function productionPathForIngredientIds(
  ingredientIds: readonly string[],
): RecipeProductionPath | null {
  if (ingredientIds.length === 0) return null

  const segments: string[][] = []
  let currentSegment: string[] = []

  for (const ingredientId of ingredientIds) {
    const capability = capabilityByIngredientId.get(ingredientId)
    if (!capability) return null

    if (capability.roles.includes('juice-base')) {
      if (!capability.baseEquipment) return null
      if (currentSegment.length > 0) {
        segments.push(currentSegment)
      }
      currentSegment = [ingredientId]
      continue
    }

    if (
      currentSegment.length === 0 ||
      !capability.roles.includes('seasoning')
    ) {
      return null
    }
    currentSegment.push(ingredientId)
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment)
  }
  if (segments.length === 0) return null

  const edges: ProductionPathEdge[] = []

  for (const segment of segments) {
    const baseId = segment[0]
    const baseCapability = capabilityByIngredientId.get(baseId)
    if (!baseCapability?.baseEquipment) return null

    edges.push({
      key: `juice:${baseId}`,
      kind: 'juicing',
      equipment: baseCapability.baseEquipment,
      fromIngredientIds: [],
      toIngredientIds: [baseId],
      addedIngredientId: baseId,
    })

    const prefix = [baseId]
    for (const seasoningId of segment.slice(1)) {
      const fromIngredientIds = [...prefix]
      prefix.push(seasoningId)
      edges.push({
        key: `season:${sequenceKey(prefix)}`,
        kind: 'seasoning',
        equipment: '調味器',
        fromIngredientIds,
        toIngredientIds: [...prefix],
        addedIngredientId: seasoningId,
      })
    }
  }

  let combined = [...segments[0]]
  for (const segment of segments.slice(1)) {
    const front = [...combined]
    const back = [...segment]
    combined = [...front, ...back]
    edges.push({
      key: `blend:${sequenceKey(front)}+${sequenceKey(back)}`,
      kind: 'blending',
      equipment: '果汁調和器',
      fromIngredientIds: front,
      secondaryFromIngredientIds: back,
      toIngredientIds: [...combined],
    })
  }

  edges.push({
    key: `finish:${sequenceKey(combined)}`,
    kind: 'finalizing',
    equipment: '果汁成品台',
    fromIngredientIds: [...combined],
    toIngredientIds: [...combined],
  })

  return {
    ingredientIds: [...ingredientIds],
    edges,
  }
}

export function productionPathForCandidate(
  candidate: RecipeCandidate,
): RecipeProductionPath | null {
  const ingredientIds = candidate.ingredients.map((name) =>
    ingredientIdByName.get(name),
  )
  if (ingredientIds.some((id) => id === undefined)) return null

  return productionPathForIngredientIds(ingredientIds as string[])
}

export function buildProductionPlan(
  recipes: ProductionRecipeInput[],
): ProductionPlan {
  const stepByKey = new Map<
    string,
    {
      edge: ProductionPathEdge
      quantity: number
      recipeIds: Set<string>
    }
  >()

  for (const recipe of recipes) {
    if (recipe.juiceUnits <= 0) continue

    const path = productionPathForIngredientIds(recipe.ingredientIds)
    if (!path) {
      throw new Error(
        `Unsupported production path for recipe ${recipe.recipeId}`,
      )
    }

    for (const edge of path.edges) {
      const current = stepByKey.get(edge.key) ?? {
        edge,
        quantity: 0,
        recipeIds: new Set<string>(),
      }
      current.quantity += recipe.juiceUnits
      current.recipeIds.add(recipe.recipeId)
      stepByKey.set(edge.key, current)
    }
  }

  const steps = [...stepByKey.values()]
    .map(({ edge, quantity, recipeIds }): ProductionStep => ({
      ...edge,
      quantity,
      operationCount: Math.ceil(quantity / PROCESSING_STACK_CAPACITY),
      recipeIds: [...recipeIds].sort(),
    }))
    .sort((a, b) => {
      const kindOrder: Record<ProductionStepKind, number> = {
        juicing: 0,
        seasoning: 1,
        blending: 2,
        finalizing: 3,
      }
      return (
        kindOrder[a.kind] - kindOrder[b.kind] ||
        a.toIngredientIds.length - b.toIngredientIds.length ||
        a.key.localeCompare(b.key)
      )
    })

  const summary: MachineOperationSummary = {
    total: 0,
    juicing: 0,
    seasoning: 0,
    finalizing: 0,
    blending: 0,
  }

  for (const step of steps) {
    summary.total += step.operationCount
    summary[step.kind] += step.operationCount
  }

  return {
    steps,
    machineOperations: summary,
    readyForFinalizingUnitsByStepKey:
      readyForFinalizingUnitsForFullPlan(steps),
    seasoningIngredientUnits:
      seasoningIngredientUnitsForSteps(steps),
    seasoningBaseJuiceUnits:
      seasoningBaseJuiceUnitsForSteps(steps),
  }
}


/**
 * Builds the executable production graph after applying already-held
 * intermediate juice stock.
 *
 * Finalizing is never skipped by intermediate stock. Instead, each finalizer
 * creates demand for its input juice node. That demand is expanded backwards:
 * exact intermediate stock satisfies the deepest currently-needed node first;
 * only the unsatisfied remainder expands into its producer edge and upstream
 * inputs. Shared-prefix demand therefore consumes one global stock pool rather
 * than reusing the same unit once per recipe.
 */
export function buildStockOffsetProductionPlan(
  recipes: ProductionRecipeInput[],
  intermediateJuiceUnits: IntermediateJuiceInventory = {},
): StockOffsetProductionPlan {
  const fullPlan = buildProductionPlan(recipes)
  const producerByNode = new Map<string, ProductionStep>()

  for (const step of fullPlan.steps) {
    if (step.kind === 'finalizing') continue
    const nodeKey = sequenceKey(step.toIngredientIds)
    const existing = producerByNode.get(nodeKey)
    if (existing && existing.key !== step.key) {
      throw new Error(
        `Multiple production edges produce intermediate node ${nodeKey}`,
      )
    }
    producerByNode.set(nodeKey, step)
  }

  const stockByNode = new Map<
    string,
    IntermediateJuiceStockUsage & { remainingToAllocate: number }
  >()

  for (const [identity, rawQuantity] of Object.entries(
    intermediateJuiceUnits,
  )) {
    const ingredientIds =
      ingredientIdsFromJuiceStateIdentity(identity)
    const availableUnits = Math.max(0, Math.floor(rawQuantity))
    if (!ingredientIds || availableUnits <= 0) continue

    stockByNode.set(sequenceKey(ingredientIds), {
      identity,
      ingredientIds,
      availableUnits,
      usedUnits: 0,
      remainingUnits: availableUnits,
      remainingToAllocate: availableUnits,
    })
  }

  const quantityByStepKey = new Map<string, number>()
  const readyForFinalizingUnitsByStepKey = new Map<string, number>()
  const recipeUsageById = new Map<string, StockOffsetRecipeUsage>()

  function usageForRecipe(recipeId: string): StockOffsetRecipeUsage {
    const existing = recipeUsageById.get(recipeId)
    if (existing) return existing
    const created: StockOffsetRecipeUsage = {
      recipeId,
      ingredientUnits: {},
      intermediateStockUnits: {},
      units: [],
    }
    recipeUsageById.set(recipeId, created)
    return created
  }

  function addStepQuantity(step: ProductionStep, quantity: number) {
    if (quantity <= 0) return
    quantityByStepKey.set(
      step.key,
      (quantityByStepKey.get(step.key) ?? 0) + quantity,
    )
  }

  function requireIntermediate(
    ingredientIds: string[],
    quantity: number,
    recipeId: string,
    unitUsage: StockOffsetRecipeUnitUsage,
    directToFinalizing = false,
  ) {
    if (quantity <= 0) return

    const nodeKey = sequenceKey(ingredientIds)
    const stock = stockByNode.get(nodeKey)
    let remaining = quantity

    if (stock) {
      const used = Math.min(stock.remainingToAllocate, remaining)
      stock.remainingToAllocate -= used
      stock.usedUnits += used
      stock.remainingUnits = stock.availableUnits - stock.usedUnits
      const usage = usageForRecipe(recipeId)
      if (used > 0) {
        usage.intermediateStockUnits[stock.identity] =
          (usage.intermediateStockUnits[stock.identity] ?? 0) + used
        unitUsage.intermediateStockUnits[stock.identity] =
          (unitUsage.intermediateStockUnits[stock.identity] ?? 0) + used
      }
      remaining -= used
    }

    if (remaining <= 0) return

    const producer = producerByNode.get(nodeKey)
    if (!producer) {
      throw new Error(
        `No production edge can satisfy intermediate node ${nodeKey}`,
      )
    }

    addStepQuantity(producer, remaining)
    if (directToFinalizing) {
      readyForFinalizingUnitsByStepKey.set(
        producer.key,
        (readyForFinalizingUnitsByStepKey.get(producer.key) ?? 0) +
          remaining,
      )
    }

    if (
      (producer.kind === 'juicing' || producer.kind === 'seasoning') &&
      producer.addedIngredientId
    ) {
      const usage = usageForRecipe(recipeId)
      usage.ingredientUnits[producer.addedIngredientId] =
        (usage.ingredientUnits[producer.addedIngredientId] ?? 0) +
        remaining
      unitUsage.ingredientUnits[producer.addedIngredientId] =
        (unitUsage.ingredientUnits[producer.addedIngredientId] ?? 0) +
        remaining
    }

    if (producer.kind === 'seasoning') {
      requireIntermediate(
        producer.fromIngredientIds,
        remaining,
        recipeId,
        unitUsage,
        false,
      )
      return
    }

    if (producer.kind === 'blending') {
      requireIntermediate(
        producer.fromIngredientIds,
        remaining,
        recipeId,
        unitUsage,
        false,
      )
      requireIntermediate(
        producer.secondaryFromIngredientIds ?? [],
        remaining,
        recipeId,
        unitUsage,
        false,
      )
    }
  }

  for (const recipe of recipes) {
    if (recipe.juiceUnits <= 0) continue
    const path = productionPathForIngredientIds(recipe.ingredientIds)
    const finalizer = path?.edges.find((edge) => edge.kind === 'finalizing')
    if (!finalizer) {
      throw new Error(
        `Unsupported production path for recipe ${recipe.recipeId}`,
      )
    }
    const fullFinalizer = fullPlan.steps.find(
      (step) => step.key === finalizer.key,
    )
    if (!fullFinalizer) {
      throw new Error(
        `Missing finalizer for recipe ${recipe.recipeId}`,
      )
    }
    addStepQuantity(fullFinalizer, recipe.juiceUnits)
    const usage = usageForRecipe(recipe.recipeId)
    for (let unit = 0; unit < recipe.juiceUnits; unit += 1) {
      const unitUsage: StockOffsetRecipeUnitUsage = {
        ingredientUnits: {},
        intermediateStockUnits: {},
      }
      requireIntermediate(
        finalizer.fromIngredientIds,
        1,
        recipe.recipeId,
        unitUsage,
        true,
      )
      usage.units.push(unitUsage)
    }
  }

  const kindOrder: Record<ProductionStepKind, number> = {
    juicing: 0,
    seasoning: 1,
    blending: 2,
    finalizing: 3,
  }

  const steps = fullPlan.steps
    .flatMap((step): ProductionStep[] => {
      const quantity = quantityByStepKey.get(step.key) ?? 0
      if (quantity <= 0) return []
      return [
        {
          ...step,
          quantity,
          operationCount: Math.ceil(
            quantity / PROCESSING_STACK_CAPACITY,
          ),
        },
      ]
    })
    .sort(
      (a, b) =>
        kindOrder[a.kind] - kindOrder[b.kind] ||
        a.toIngredientIds.length - b.toIngredientIds.length ||
        a.key.localeCompare(b.key),
    )

  const machineOperations: MachineOperationSummary = {
    total: 0,
    juicing: 0,
    seasoning: 0,
    finalizing: 0,
    blending: 0,
  }

  for (const step of steps) {
    machineOperations.total += step.operationCount
    machineOperations[step.kind] += step.operationCount
  }

  const intermediateStockUsage = [...stockByNode.values()]
    .filter((stock) => stock.usedUnits > 0)
    .map((stock): IntermediateJuiceStockUsage => ({
      identity: stock.identity,
      ingredientIds: [...stock.ingredientIds],
      availableUnits: stock.availableUnits,
      usedUnits: stock.usedUnits,
      remainingUnits: stock.remainingUnits,
    }))
    .sort(
      (a, b) =>
        b.ingredientIds.length - a.ingredientIds.length ||
        a.identity.localeCompare(b.identity),
    )

  const recipeUsage = [...recipeUsageById.values()]
    .map((usage): StockOffsetRecipeUsage => ({
      recipeId: usage.recipeId,
      ingredientUnits: { ...usage.ingredientUnits },
      intermediateStockUnits: { ...usage.intermediateStockUnits },
      units: usage.units.map((unit) => ({
        ingredientUnits: { ...unit.ingredientUnits },
        intermediateStockUnits: { ...unit.intermediateStockUnits },
      })),
    }))
    .sort((a, b) => a.recipeId.localeCompare(b.recipeId))

  return {
    steps,
    machineOperations,
    readyForFinalizingUnitsByStepKey: Object.fromEntries(
      readyForFinalizingUnitsByStepKey,
    ),
    seasoningIngredientUnits:
      seasoningIngredientUnitsForSteps(steps),
    seasoningBaseJuiceUnits:
      seasoningBaseJuiceUnitsForSteps(steps),
    intermediateStockUsage,
    recipeUsage,
  }
}
