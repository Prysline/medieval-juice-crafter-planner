import { ingredients } from '../data/ingredients'
import type { InventoryState, PlannerSettings } from '../types'
import { buildInventoryCapacitySummary } from './inventoryCapacity'
import {
  PROCESSING_STACK_CAPACITY,
  WATER_STACK_CAPACITY,
} from './inventoryRules'
import type { PreparationShortfall } from './preparationShortfall'
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
  snapshot: ProductionStorageSnapshot
}

export interface ProductionLogisticsPlan {
  feasible: boolean
  issues: string[]
  productionPlan: ProductionPlan
  actions: ProductionLogisticsAction[]
  ingredientAcquisitionTrips: number
  waterFetchTrips: number
  initialSnapshot: ProductionStorageSnapshot
  finalSnapshot: ProductionStorageSnapshot
}

interface PendingOperation {
  id: string
  step: ProductionStep
  quantity: number
}

const ingredientById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient]),
)

function sequenceKey(ids: string[]): string {
  return ids.join('>')
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

  return {
    shelfSlotsUsed,
    shelfSlotsAvailable: capacity.shelfSlotCapacity,
    backpackSlotsUsed,
    backpackSlotsAvailable:
      capacity.backpackSlotsRemainingAfterCarriedJars,
    carriedJarSlots: capacity.carriedJarSlotCost,
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

function requiredIntermediateInputs(
  step: ProductionStep,
): string[][] {
  if (step.kind === 'juicing') return []
  if (step.kind === 'seasoning' || step.kind === 'finalizing') {
    return [step.fromIngredientIds]
  }
  return [
    step.fromIngredientIds,
    step.secondaryFromIngredientIds ?? [],
  ]
}

function canRunWithCurrentIntermediateStock(
  operation: PendingOperation,
  materials: Map<string, MaterialState>,
): boolean {
  return requiredIntermediateInputs(operation.step).every(
    (sequence) =>
      sequence.length > 0 &&
      materialQuantity(materials, intermediateKey(sequence)) >=
        operation.quantity,
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
    return `${sequenceKey(step.fromIngredientIds)} + ${seasoning} ×${quantity} → ${sequenceKey(step.toIngredientIds)}`
  }
  if (step.kind === 'blending') {
    return `${sequenceKey(step.fromIngredientIds)} + ${sequenceKey(step.secondaryFromIngredientIds ?? [])} → ${sequenceKey(step.toIngredientIds)} ×${quantity}`
  }
  return `${sequenceKey(step.fromIngredientIds)} + 水 ×${quantity} → 成品 ×${quantity * 2}`
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
  let ingredientAcquisitionTrips = 0
  let waterFetchTrips = 0

  if (!storageFits(initialSnapshot)) {
    issues.push(
      '現有 production materials 無法放入目前一般架與常駐果汁罐占用後的背包空間。',
    )
  }

  const pending: PendingOperation[] = productionPlan.steps.flatMap(
    (step) =>
      splitOperations(step.quantity).map((quantity, index) => ({
        id: `${step.key}#${index + 1}`,
        step,
        quantity,
      })),
  )

  function pushAction(
    kind: ProductionLogisticsActionKind,
    label: string,
    quantity: number,
    snapshot: ProductionStorageSnapshot,
    equipment?: ProductionStep['equipment'],
  ) {
    actions.push({
      index: actions.length + 1,
      kind,
      label,
      equipment,
      quantity,
      snapshot,
    })
  }

  function canAcquireOneStack(): boolean {
    return backpackFreeSlots(
      storageSnapshot(materials, inventory, settings),
    ) >= 1
  }

  function ensureRaw(ingredientId: string, quantity: number): boolean {
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
    const snapshot = storageSnapshot(materials, inventory, settings)
    if (!storageFits(snapshot)) {
      removeMaterial(materials, key, missing)
      return false
    }

    ingredientAcquisitionTrips += 1
    pushAction(
      'acquire-ingredient',
      `取得 ${ingredientById.get(ingredientId)?.name ?? ingredientId} ×${missing}`,
      missing,
      snapshot,
    )
    return true
  }

  function ensureWater(quantity: number): boolean {
    const available = materialQuantity(materials, 'water')
    if (available >= quantity) return true

    const missing = quantity - available
    if (!canAcquireOneStack()) return false

    addMaterial(
      materials,
      'water',
      'water',
      missing,
      WATER_STACK_CAPACITY,
    )
    const snapshot = storageSnapshot(materials, inventory, settings)
    if (!storageFits(snapshot)) {
      removeMaterial(materials, 'water', missing)
      return false
    }

    waterFetchTrips += 1
    pushAction(
      'fetch-water',
      `取水 ×${missing}`,
      missing,
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

      if (step.kind === 'juicing') {
        const ingredientId = step.addedIngredientId
        if (!ingredientId || !ensureRaw(ingredientId, quantity)) {
          materials.clear()
          for (const [key, value] of materialsBefore) {
            materials.set(key, value)
          }
          continue
        }
      } else if (step.kind === 'seasoning') {
        const ingredientId = step.addedIngredientId
        if (!ingredientId || !ensureRaw(ingredientId, quantity)) {
          materials.clear()
          for (const [key, value] of materialsBefore) {
            materials.set(key, value)
          }
          continue
        }
      } else if (step.kind === 'finalizing') {
        if (!ensureWater(quantity)) {
          materials.clear()
          for (const [key, value] of materialsBefore) {
            materials.set(key, value)
          }
          continue
        }
      }

      if (step.kind === 'juicing') {
        removeMaterial(
          materials,
          rawKey(step.addedIngredientId ?? ''),
          quantity,
        )
      } else if (step.kind === 'seasoning') {
        removeMaterial(
          materials,
          intermediateKey(step.fromIngredientIds),
          quantity,
        )
        removeMaterial(
          materials,
          rawKey(step.addedIngredientId ?? ''),
          quantity,
        )
      } else if (step.kind === 'blending') {
        removeMaterial(
          materials,
          intermediateKey(step.fromIngredientIds),
          quantity,
        )
        removeMaterial(
          materials,
          intermediateKey(step.secondaryFromIngredientIds ?? []),
          quantity,
        )
      } else {
        removeMaterial(
          materials,
          intermediateKey(step.fromIngredientIds),
          quantity,
        )
        removeMaterial(materials, 'water', quantity)
      }

      const machineSlotsAvailable = equipmentSlotCapacity(step.kind)
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
        pushAction(
          'handoff-finished',
          `成品 ×${quantity * 2} 交給果汁罐裝載排程`,
          quantity * 2,
          snapshot,
          step.equipment,
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
          materials.clear()
          for (const [key, value] of materialsBefore) {
            materials.set(key, value)
          }
          continue
        }
        pushAction(
          'unload-intermediate',
          `${sequenceKey(step.toIngredientIds)} ×${quantity} → 一般 storage`,
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
      issues.push(
        '目前 backpack / shelf capacity 無法在不使用地面 storage 的前提下完成下一個 production operation。',
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
    ingredientAcquisitionTrips,
    waterFetchTrips,
    initialSnapshot,
    finalSnapshot,
  }
}
