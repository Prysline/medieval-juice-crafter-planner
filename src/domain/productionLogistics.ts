import { ingredients } from '../data/ingredients'
import type { InventoryState, PlannerSettings } from '../types'
import { buildInventoryCapacitySummary } from './inventoryCapacity'
import {
  PROCESSING_STACK_CAPACITY,
  WATER_STACK_CAPACITY,
} from './inventoryRules'
import type { PreparationShortfall } from './preparationShortfall'
import type { MultiTripProductionJarFill } from './multiTripReplenishment'
import {
  buildProductionPlan,
  type ProductionPlan,
  type ProductionStep,
  type ProductionStepKind,
} from './productionPlan'

type MaterialKind = 'raw' | 'water' | 'intermediate'

interface MaterialState {
  kind: MaterialKind
  quantity: number
  stackCapacity: number
}

export interface ProductionStorageSnapshot {
  shelfSlotsUsed: number
  shelfSlotsAvailable: number
  backpackSlotsUsed: number
  backpackSlotsAvailable: number
  carriedJarSlots: number
  outputJarReceiverSlots: number
  carriedOutputJarSlots: number
  rackOutputJarSlots: number
  machineSlotsUsed: number
  machineSlotsAvailable: number
}

export type ProductionLogisticsActionKind =
  | 'acquire-ingredient'
  | 'fetch-water'
  | 'load-machine'
  | 'run-machine'
  | 'unload-intermediate'
  | 'handoff-finished'

export interface ProductionLogisticsAction {
  index: number
  kind: ProductionLogisticsActionKind
  label: string
  equipment?: ProductionStep['equipment']
  quantity: number
  outputJarReceiver?: 'carried-jar' | 'jar-rack'
  outputPhysicalJarId?: string
  outputRecipeId?: string
  beforeSalesTripNumber?: number
  requiresCompletedSalesTrips?: number
  outputJarServingsAfterHandoff?: number
  snapshot: ProductionStorageSnapshot
}

export interface ProductionLogisticsPlan {
  feasible: boolean
  issues: string[]
  productionPlan: ProductionPlan
  actions: ProductionLogisticsAction[]
  ingredientAcquisitionActions: number
  waterFetchTrips: number
  initialSnapshot: ProductionStorageSnapshot
  finalSnapshot: ProductionStorageSnapshot
}

interface PendingOperation {
  id: string
  step: ProductionStep
  quantity: number
  receiverFill?: MultiTripProductionJarFill
}

const ingredientById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient]),
)

function sequenceKey(ids: string[]): string {
  return ids.join('>')
}

function sequenceLabel(ids: string[]): string {
  return ids
    .map((id) => ingredientById.get(id)?.name ?? id)
    .join(' ▸ ')
}

function rawKey(ingredientId: string): string {
  return `raw:${ingredientId}`
}

function intermediateKey(ingredientIds: string[]): string {
  return `juice:${sequenceKey(ingredientIds)}`
}

function stackCount(quantity: number, capacity: number): number {
  return quantity <= 0 ? 0 : Math.ceil(quantity / capacity)
}

function equipmentSlotCapacity(kind: ProductionStepKind): number {
  return kind === 'juicing' ? 2 : 3
}

function operationInputCount(kind: ProductionStepKind): number {
  return kind === 'juicing' ? 1 : 2
}

function splitOperations(quantity: number): number[] {
  const result: number[] = []
  let remaining = quantity
  while (remaining > 0) {
    const next = Math.min(PROCESSING_STACK_CAPACITY, remaining)
    result.push(next)
    remaining -= next
  }
  return result
}

function cloneMaterials(
  source: Map<string, MaterialState>,
): Map<string, MaterialState> {
  return new Map(
    [...source.entries()].map(([key, material]) => [
      key,
      { ...material },
    ]),
  )
}

function materialSlots(materials: Map<string, MaterialState>): number {
  return [...materials.values()].reduce(
    (sum, material) =>
      sum + stackCount(material.quantity, material.stackCapacity),
    0,
  )
}

function addMaterial(
  materials: Map<string, MaterialState>,
  key: string,
  kind: MaterialKind,
  quantity: number,
  stackCapacity: number,
) {
  if (quantity <= 0) return
  const current = materials.get(key)
  materials.set(key, {
    kind,
    quantity: (current?.quantity ?? 0) + quantity,
    stackCapacity,
  })
}

function removeMaterial(
  materials: Map<string, MaterialState>,
  key: string,
  quantity: number,
): boolean {
  const current = materials.get(key)
  if (!current || current.quantity < quantity) return false

  const next = current.quantity - quantity
  if (next === 0) {
    materials.delete(key)
  } else {
    materials.set(key, { ...current, quantity: next })
  }
  return true
}

function materialQuantity(
  materials: Map<string, MaterialState>,
  key: string,
): number {
  return materials.get(key)?.quantity ?? 0
}

function storageSnapshot(
  materials: Map<string, MaterialState>,
  inventory: InventoryState,
  settings: PlannerSettings,
  machineSlotsUsed = 0,
  machineSlotsAvailable = 0,
): ProductionStorageSnapshot {
  const capacity = buildInventoryCapacitySummary(inventory, settings)
  const totalSlots = materialSlots(materials)
  const shelfSlotsUsed = Math.min(
    totalSlots,
    capacity.shelfSlotCapacity,
  )
  const backpackSlotsUsed = Math.max(0, totalSlots - shelfSlotsUsed)
  const carriedOutputJarSlots = Math.min(
    capacity.physicalJuiceJarCount,
    capacity.effectiveReservedJuiceJarSlots,
  )
  const nonCarriedPhysicalJars = Math.max(
    0,
    capacity.physicalJuiceJarCount -
      carriedOutputJarSlots,
  )
  const rackOutputJarSlots = Math.min(
    nonCarriedPhysicalJars,
    capacity.jarRackStagingCapacity,
  )

  return {
    shelfSlotsUsed,
    shelfSlotsAvailable: capacity.shelfSlotCapacity,
    backpackSlotsUsed,
    backpackSlotsAvailable:
      capacity.backpackSlotsRemainingAfterCarriedJars,
    carriedJarSlots: capacity.carriedJarSlotCost,
    outputJarReceiverSlots:
      carriedOutputJarSlots + rackOutputJarSlots,
    carriedOutputJarSlots,
    rackOutputJarSlots,
    machineSlotsUsed,
    machineSlotsAvailable,
  }
}

function storageFits(snapshot: ProductionStorageSnapshot): boolean {
  return (
    snapshot.shelfSlotsUsed <= snapshot.shelfSlotsAvailable &&
    snapshot.backpackSlotsUsed <= snapshot.backpackSlotsAvailable
  )
}

function backpackFreeSlots(snapshot: ProductionStorageSnapshot): number {
  return Math.max(
    0,
    snapshot.backpackSlotsAvailable - snapshot.backpackSlotsUsed,
  )
}

function intermediateRequirements(
  operation: PendingOperation,
): Map<string, number> {
  const requirements = new Map<string, number>()
  const sequences =
    operation.step.kind === 'juicing'
      ? []
      : operation.step.kind === 'seasoning' ||
          operation.step.kind === 'finalizing'
        ? [operation.step.fromIngredientIds]
        : [
            operation.step.fromIngredientIds,
            operation.step.secondaryFromIngredientIds ?? [],
          ]

  for (const sequence of sequences) {
    if (sequence.length === 0) continue
    const key = intermediateKey(sequence)
    requirements.set(
      key,
      (requirements.get(key) ?? 0) + operation.quantity,
    )
  }
  return requirements
}

function canRunWithCurrentIntermediateStock(
  operation: PendingOperation,
  materials: Map<string, MaterialState>,
): boolean {
  return [...intermediateRequirements(operation).entries()].every(
    ([key, quantity]) => materialQuantity(materials, key) >= quantity,
  )
}

function operationPriority(operation: PendingOperation): number {
  const kindWeight: Record<ProductionStepKind, number> = {
    finalizing: 40,
    blending: 30,
    seasoning: 20,
    juicing: 10,
  }
  return (
    kindWeight[operation.step.kind] * 100 +
    operation.step.toIngredientIds.length
  )
}

function actionLabel(
  step: ProductionStep,
  quantity: number,
): string {
  if (step.kind === 'juicing') {
    const name =
      ingredientById.get(step.addedIngredientId ?? '')?.name ??
      step.addedIngredientId ??
      '原料'
    return `${name} ×${quantity} → 原汁 ×${quantity}`
  }
  if (step.kind === 'seasoning') {
    const seasoning =
      ingredientById.get(step.addedIngredientId ?? '')?.name ??
      step.addedIngredientId ??
      '調味材料'
    return `${sequenceLabel(step.fromIngredientIds)} + ${seasoning} ×${quantity} → ${sequenceLabel(step.toIngredientIds)}`
  }
  if (step.kind === 'blending') {
    return `${sequenceLabel(step.fromIngredientIds)} + ${sequenceLabel(step.secondaryFromIngredientIds ?? [])} → ${sequenceLabel(step.toIngredientIds)} ×${quantity}`
  }
  return `${sequenceLabel(step.fromIngredientIds)} + 水 ×${quantity} → 成品 ×${quantity * 2}`
}

export function buildNetProductionPlan(
  shortfall: PreparationShortfall,
): ProductionPlan {
  return buildProductionPlan(
    shortfall.recipes
      .filter((recipe) => recipe.juiceUnitsToPrepare > 0)
      .map((recipe) => ({
        recipeId: recipe.recipeId,
        recipeName: recipe.recipeName,
        ingredientIds: [...recipe.ingredientIds],
        juiceUnits: recipe.juiceUnitsToPrepare,
        assignedServings: recipe.servingsToProduce,
      })),
  )
}

export function buildProductionLogisticsPlan(
  shortfall: PreparationShortfall,
  inventory: InventoryState,
  settings: PlannerSettings,
  receiverTimeline: MultiTripProductionJarFill[],
): ProductionLogisticsPlan {
  const productionPlan = buildNetProductionPlan(shortfall)
  const materials = new Map<string, MaterialState>()

  for (const [ingredientId, quantity] of Object.entries(
    inventory.ingredientUnits,
  )) {
    addMaterial(
      materials,
      rawKey(ingredientId),
      'raw',
      quantity,
      PROCESSING_STACK_CAPACITY,
    )
  }
  addMaterial(
    materials,
    'water',
    'water',
    inventory.waterUnits,
    WATER_STACK_CAPACITY,
  )

  const initialSnapshot = storageSnapshot(
    materials,
    inventory,
    settings,
  )
  const issues: string[] = []
  const actions: ProductionLogisticsAction[] = []
  let ingredientAcquisitionActions = 0
  let waterFetchTrips = 0
  let externalWaterRemaining = shortfall.waterUnitsToFetch
  const capacitySummary = buildInventoryCapacitySummary(
    inventory,
    settings,
  )
  const inventoryJarIds = new Set(
    inventory.juiceJars.map((jar) => jar.id),
  )
  for (const fill of receiverTimeline) {
    if (!inventoryJarIds.has(fill.physicalJarId)) {
      issues.push(
        `finalizer receiver ${fill.physicalJarId} 不存在於目前 physical juice jar inventory。`,
      )
      continue
    }
    if (
      fill.receiver === 'jar-rack' &&
      capacitySummary.jarRackStagingCapacity < 1
    ) {
      issues.push(
        `finalizer receiver ${fill.physicalJarId} 需要放在果汁罐架，但目前沒有可用的果汁罐架 slot。`,
      )
    }
    if (
      fill.servings < 1 ||
      fill.servings > 10 ||
      fill.servings % 2 !== 0
    ) {
      issues.push(
        `finalizer receiver ${fill.physicalJarId} 的成品裝罐量 ${fill.servings} 無法由果汁成品台單次 2～10 份偶數產量解釋。`,
      )
    }
  }

  if (
    productionPlan.steps.length > 0 &&
    capacitySummary.backpackSlotsRemainingAfterCarriedJars < 1
  ) {
    issues.push(
      '果汁罐的強制隨身／固定預留格已占滿背包，沒有可供架子 ↔ 機器搬運使用的暫時格。',
    )
  }

  if (!storageFits(initialSnapshot)) {
    issues.push(
      '現有製作物資無法放入目前一般架與果汁罐占用／預留後的背包空間。',
    )
  }

  const usedReceiverFills = new Set<MultiTripProductionJarFill>()
  const pending: PendingOperation[] = productionPlan.steps.flatMap(
    (step) => {
      if (step.kind !== 'finalizing') {
        return splitOperations(step.quantity).map(
          (quantity, index) => ({
            id: `${step.key}#${index + 1}`,
            step,
            quantity,
          }),
        )
      }

      const fills = receiverTimeline
        .filter((fill) => step.recipeIds.includes(fill.recipeId))
        .sort(
          (a, b) =>
            a.beforeTripNumber - b.beforeTripNumber ||
            a.physicalJarId.localeCompare(b.physicalJarId),
        )
      const receiverJuiceUnits = fills.reduce(
        (sum, fill) => sum + fill.servings / 2,
        0,
      )
      if (receiverJuiceUnits !== step.quantity) {
        issues.push(
          `finalizer receiver timeline 與 ${step.key} 製作量不一致：需要 ${step.quantity} juice units，但 receiver timeline 對應 ${receiverJuiceUnits}。`,
        )
      }

      return fills.map((fill, index) => {
        usedReceiverFills.add(fill)
        return {
          id: `${step.key}#receiver-${index + 1}`,
          step,
          quantity: fill.servings / 2,
          receiverFill: fill,
        }
      })
    },
  )

  if (usedReceiverFills.size !== receiverTimeline.length) {
    issues.push(
      'finalizer receiver timeline 含有無法對應到目前 production recipe 的裝罐事件。',
    )
  }

  function pushAction(
    kind: ProductionLogisticsActionKind,
    label: string,
    quantity: number,
    snapshot: ProductionStorageSnapshot,
    equipment?: ProductionStep['equipment'],
    outputJarReceiver?: 'carried-jar' | 'jar-rack',
    receiverFill?: MultiTripProductionJarFill,
  ) {
    actions.push({
      index: actions.length + 1,
      kind,
      label,
      equipment,
      quantity,
      outputJarReceiver,
      outputPhysicalJarId: receiverFill?.physicalJarId,
      outputRecipeId: receiverFill?.recipeId,
      beforeSalesTripNumber: receiverFill?.beforeTripNumber,
      requiresCompletedSalesTrips: receiverFill
        ? Math.max(0, receiverFill.beforeTripNumber - 1)
        : undefined,
      outputJarServingsAfterHandoff:
        receiverFill?.servingsAfterFill,
      snapshot,
    })
  }

  function canAcquireOneStack(): boolean {
    return backpackFreeSlots(
      storageSnapshot(materials, inventory, settings),
    ) >= 1
  }

  function ensureRaw(
    ingredientId: string,
    quantity: number,
    machineSlotsUsed = 0,
    machineSlotsAvailable = 0,
  ): boolean {
    const key = rawKey(ingredientId)
    const available = materialQuantity(materials, key)
    if (available >= quantity) return true

    const missing = quantity - available
    if (!canAcquireOneStack()) return false

    addMaterial(
      materials,
      key,
      'raw',
      missing,
      PROCESSING_STACK_CAPACITY,
    )
    const snapshot = storageSnapshot(
      materials,
      inventory,
      settings,
      machineSlotsUsed,
      machineSlotsAvailable,
    )
    if (!storageFits(snapshot)) {
      removeMaterial(materials, key, missing)
      return false
    }

    ingredientAcquisitionActions += 1
    pushAction(
      'acquire-ingredient',
      `取得 ${ingredientById.get(ingredientId)?.name ?? ingredientId} ×${missing}`,
      missing,
      snapshot,
    )
    return true
  }

  function ensureWater(
    quantity: number,
    machineSlotsUsed = 0,
    machineSlotsAvailable = 0,
  ): boolean {
    const available = materialQuantity(materials, 'water')
    if (available >= quantity) return true

    const missing = quantity - available
    const currentSnapshot = storageSnapshot(
      materials,
      inventory,
      settings,
    )
    const freeSlots = backpackFreeSlots(currentSnapshot)
    if (freeSlots < 1) return false

    const fetchUnits = Math.min(
      externalWaterRemaining,
      freeSlots * WATER_STACK_CAPACITY,
    )
    if (fetchUnits < missing) return false

    addMaterial(
      materials,
      'water',
      'water',
      fetchUnits,
      WATER_STACK_CAPACITY,
    )
    const snapshot = storageSnapshot(
      materials,
      inventory,
      settings,
      machineSlotsUsed,
      machineSlotsAvailable,
    )
    if (!storageFits(snapshot)) {
      removeMaterial(materials, 'water', fetchUnits)
      return false
    }

    externalWaterRemaining -= fetchUnits
    waterFetchTrips += 1
    pushAction(
      'fetch-water',
      `取水 ×${fetchUnits}`,
      fetchUnits,
      snapshot,
    )
    return true
  }

  let guard = 0
  while (pending.length > 0 && issues.length === 0) {
    guard += 1
    if (guard > 10000) {
      issues.push('Production logistics scheduler exceeded its safety limit.')
      break
    }

    const candidates = [...pending].sort(
      (a, b) =>
        operationPriority(b) - operationPriority(a) ||
        a.id.localeCompare(b.id),
    )

    let executed = false

    for (const operation of candidates) {
      const { step, quantity } = operation

      if (
        step.kind !== 'juicing' &&
        !canRunWithCurrentIntermediateStock(operation, materials)
      ) {
        continue
      }

      const materialsBefore = cloneMaterials(materials)
      const actionsLengthBefore = actions.length
      const ingredientAcquisitionActionsBefore =
        ingredientAcquisitionActions
      const waterFetchTripsBefore = waterFetchTrips
      const externalWaterRemainingBefore = externalWaterRemaining

      const rollbackOperationAttempt = () => {
        materials.clear()
        for (const [key, value] of materialsBefore) {
          materials.set(key, value)
        }
        actions.splice(actionsLengthBefore)
        ingredientAcquisitionActions =
          ingredientAcquisitionActionsBefore
        waterFetchTrips = waterFetchTripsBefore
        externalWaterRemaining = externalWaterRemainingBefore
      }

      const machineSlotsAvailable = equipmentSlotCapacity(step.kind)
      let preloadedMachineSlots = 0

      if (step.kind === 'juicing') {
        const ingredientId = step.addedIngredientId
        if (!ingredientId || !ensureRaw(ingredientId, quantity)) {
          rollbackOperationAttempt()
          continue
        }
        removeMaterial(materials, rawKey(ingredientId), quantity)
      } else {
        const requirements = intermediateRequirements(operation)
        for (const [key, required] of requirements) {
          removeMaterial(materials, key, required)
          preloadedMachineSlots += 1
        }

        if (step.kind === 'seasoning') {
          const ingredientId = step.addedIngredientId
          if (
            !ingredientId ||
            !ensureRaw(
              ingredientId,
              quantity,
              preloadedMachineSlots,
              machineSlotsAvailable,
            )
          ) {
            rollbackOperationAttempt()
            continue
          }
          removeMaterial(materials, rawKey(ingredientId), quantity)
        } else if (step.kind === 'finalizing') {
          if (
            !ensureWater(
              quantity,
              preloadedMachineSlots,
              machineSlotsAvailable,
            )
          ) {
            rollbackOperationAttempt()
            continue
          }
          removeMaterial(materials, 'water', quantity)
        }
      }

      const loadedSnapshot = storageSnapshot(
        materials,
        inventory,
        settings,
        operationInputCount(step.kind),
        machineSlotsAvailable,
      )
      pushAction(
        'load-machine',
        actionLabel(step, quantity),
        quantity,
        loadedSnapshot,
        step.equipment,
      )

      const outputSnapshot = storageSnapshot(
        materials,
        inventory,
        settings,
        1,
        machineSlotsAvailable,
      )
      pushAction(
        'run-machine',
        actionLabel(step, quantity),
        quantity,
        outputSnapshot,
        step.equipment,
      )

      if (step.kind === 'finalizing') {
        const snapshot = storageSnapshot(materials, inventory, settings)
        const receiverFill = operation.receiverFill
        if (!receiverFill) {
          rollbackOperationAttempt()
          continue
        }

        const outputJarReceiver = receiverFill.receiver

        if (receiverFill.servings !== quantity * 2) {
          rollbackOperationAttempt()
          continue
        }

        pushAction(
          'handoff-finished',
          `第 ${receiverFill.beforeTripNumber} 趟前：成品 ×${receiverFill.servings} → ${receiverFill.physicalJarId}（${receiverFill.recipeName}）`,
          receiverFill.servings,
          snapshot,
          step.equipment,
          outputJarReceiver,
          receiverFill,
        )
      } else {
        addMaterial(
          materials,
          intermediateKey(step.toIngredientIds),
          'intermediate',
          quantity,
          PROCESSING_STACK_CAPACITY,
        )
        const snapshot = storageSnapshot(materials, inventory, settings)
        if (!storageFits(snapshot)) {
          rollbackOperationAttempt()
          continue
        }
        pushAction(
          'unload-intermediate',
          `${sequenceLabel(step.toIngredientIds)} ×${quantity} → 一般暫存`,
          quantity,
          snapshot,
          step.equipment,
        )
      }

      const pendingIndex = pending.findIndex(
        (item) => item.id === operation.id,
      )
      pending.splice(pendingIndex, 1)
      executed = true
      break
    }

    if (!executed) {
      const receiverSnapshot = storageSnapshot(
        materials,
        inventory,
        settings,
      )
      const finalizerReadyWithoutReceiver = pending.some(
        (operation) =>
          operation.step.kind === 'finalizing' &&
          canRunWithCurrentIntermediateStock(operation, materials),
      )

      issues.push(
        finalizerReadyWithoutReceiver
          ? 'finalizer output 無法依販售排程指定的 physical juice jar 時序完成裝罐；請檢查接收罐內容、容量與可用時點。'
          : '目前 backpack / shelf capacity 無法在不使用地面 storage 的前提下完成下一個 production operation。',
      )
    }
  }

  const finalSnapshot = storageSnapshot(
    materials,
    inventory,
    settings,
  )

  return {
    feasible: issues.length === 0,
    issues,
    productionPlan,
    actions,
    ingredientAcquisitionActions,
    waterFetchTrips,
    initialSnapshot,
    finalSnapshot,
  }
}
