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
  | 'move-shelf-to-backpack'
  | 'move-backpack-to-shelf'
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

interface PrimaryInputRequirement {
  key: string
  kind: 'raw' | 'water'
  quantity: number
  stackCapacity: number
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

function replaceMaterials(
  target: Map<string, MaterialState>,
  source: Map<string, MaterialState>,
) {
  target.clear()
  for (const [key, material] of source) {
    target.set(key, { ...material })
  }
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

function locatedMaterialQuantity(
  shelfMaterials: Map<string, MaterialState>,
  backpackMaterials: Map<string, MaterialState>,
  key: string,
): number {
  return (
    materialQuantity(shelfMaterials, key) +
    materialQuantity(backpackMaterials, key)
  )
}

function storageSnapshot(
  shelfMaterials: Map<string, MaterialState>,
  backpackMaterials: Map<string, MaterialState>,
  inventory: InventoryState,
  settings: PlannerSettings,
  machineSlotsUsed = 0,
  machineSlotsAvailable = 0,
): ProductionStorageSnapshot {
  const capacity = buildInventoryCapacitySummary(inventory, settings)
  const carriedOutputJarSlots = Math.min(
    capacity.physicalJuiceJarCount,
    capacity.effectiveReservedJuiceJarSlots,
  )
  const nonCarriedPhysicalJars = Math.max(
    0,
    capacity.physicalJuiceJarCount - carriedOutputJarSlots,
  )
  const rackOutputJarSlots = Math.min(
    nonCarriedPhysicalJars,
    capacity.jarRackStagingCapacity,
  )

  return {
    shelfSlotsUsed: materialSlots(shelfMaterials),
    shelfSlotsAvailable: capacity.shelfSlotCapacity,
    backpackSlotsUsed: materialSlots(backpackMaterials),
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

function availableAdditionalQuantity(
  currentQuantity: number,
  stackCapacity: number,
  freeSlots: number,
): number {
  const partialRoom =
    currentQuantity > 0 && currentQuantity % stackCapacity !== 0
      ? stackCapacity - (currentQuantity % stackCapacity)
      : 0
  return partialRoom + freeSlots * stackCapacity
}

function quantityToFreeOneStack(
  quantity: number,
  stackCapacity: number,
): number {
  const stacks = stackCount(quantity, stackCapacity)
  if (stacks <= 0) return 0
  const quantityAfter = Math.max(0, (stacks - 1) * stackCapacity)
  return quantity - quantityAfter
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
  shelfMaterials: Map<string, MaterialState>,
  backpackMaterials: Map<string, MaterialState>,
): boolean {
  return [...intermediateRequirements(operation).entries()].every(
    ([key, quantity]) =>
      locatedMaterialQuantity(
        shelfMaterials,
        backpackMaterials,
        key,
      ) >= quantity,
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

function materialLabel(key: string): string {
  if (key === 'water') return '水'
  if (key.startsWith('raw:')) {
    const ingredientId = key.slice('raw:'.length)
    return ingredientById.get(ingredientId)?.name ?? ingredientId
  }
  if (key.startsWith('juice:')) {
    const ids = key
      .slice('juice:'.length)
      .split('>')
      .filter(Boolean)
    return sequenceLabel(ids)
  }
  return key
}

function primaryInputRequirements(
  operations: PendingOperation[],
): PrimaryInputRequirement[] {
  const requirementByKey = new Map<
    string,
    PrimaryInputRequirement
  >()

  for (const operation of operations) {
    const { step, quantity } = operation
    let requirement: PrimaryInputRequirement | null = null

    if (step.kind === 'juicing' || step.kind === 'seasoning') {
      const ingredientId = step.addedIngredientId
      if (!ingredientId) continue
      requirement = {
        key: rawKey(ingredientId),
        kind: 'raw',
        quantity,
        stackCapacity: PROCESSING_STACK_CAPACITY,
      }
    } else if (step.kind === 'finalizing') {
      requirement = {
        key: 'water',
        kind: 'water',
        quantity,
        stackCapacity: WATER_STACK_CAPACITY,
      }
    }

    if (!requirement) continue
    const current = requirementByKey.get(requirement.key)
    requirementByKey.set(requirement.key, {
      ...requirement,
      quantity: (current?.quantity ?? 0) + requirement.quantity,
    })
  }

  return [...requirementByKey.values()]
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
  const capacitySummary = buildInventoryCapacitySummary(
    inventory,
    settings,
  )
  const shelfMaterials = new Map<string, MaterialState>()
  const backpackMaterials = new Map<string, MaterialState>()

  function placeInitialMaterial(
    key: string,
    kind: MaterialKind,
    quantity: number,
    stackCapacity: number,
  ) {
    if (quantity <= 0) return

    const freeShelfSlots = Math.max(
      0,
      capacitySummary.shelfSlotCapacity - materialSlots(shelfMaterials),
    )
    const shelfQuantity = Math.min(
      quantity,
      freeShelfSlots * stackCapacity,
    )
    addMaterial(
      shelfMaterials,
      key,
      kind,
      shelfQuantity,
      stackCapacity,
    )
    addMaterial(
      backpackMaterials,
      key,
      kind,
      quantity - shelfQuantity,
      stackCapacity,
    )
  }

  for (const [ingredientId, quantity] of Object.entries(
    inventory.ingredientUnits,
  )) {
    placeInitialMaterial(
      rawKey(ingredientId),
      'raw',
      quantity,
      PROCESSING_STACK_CAPACITY,
    )
  }
  placeInitialMaterial(
    'water',
    'water',
    inventory.waterUnits,
    WATER_STACK_CAPACITY,
  )

  const initialSnapshot = storageSnapshot(
    shelfMaterials,
    backpackMaterials,
    inventory,
    settings,
  )
  const issues: string[] = []
  const actions: ProductionLogisticsAction[] = []
  let ingredientAcquisitionActions = 0
  let waterFetchTrips = 0
  let externalWaterRemaining = shortfall.waterUnitsToFetch

  const inventoryJarIds = new Set(
    inventory.juiceJars.map((jar) => jar.id),
  )
  for (const fill of receiverTimeline) {
    if (!inventoryJarIds.has(fill.physicalJarId)) {
      issues.push(
        `成品接收罐 ${fill.physicalJarId} 不存在於目前的實體果汁罐庫存。`,
      )
      continue
    }
    if (
      fill.receiver === 'jar-rack' &&
      capacitySummary.jarRackStagingCapacity < 1
    ) {
      issues.push(
        `成品接收罐 ${fill.physicalJarId} 需要放在果汁罐架，但目前沒有可用的果汁罐架格。`,
      )
    }
    if (
      fill.servings < 1 ||
      fill.servings > 10 ||
      fill.servings % 2 !== 0
    ) {
      issues.push(
        `成品接收罐 ${fill.physicalJarId} 的裝罐量 ${fill.servings} 份不符合果汁成品台單次 2～10 份、偶數產量的規則。`,
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
          `成品接收罐時序與 ${step.key} 製作量不一致：需要 ${step.quantity} 個製作單位，但接收時序只對應 ${receiverJuiceUnits} 個。`,
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
      '成品接收罐時序含有無法對應到目前製作配方的裝罐事件。',
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

  function currentSnapshot(
    machineSlotsUsed = 0,
    machineSlotsAvailable = 0,
  ): ProductionStorageSnapshot {
    return storageSnapshot(
      shelfMaterials,
      backpackMaterials,
      inventory,
      settings,
      machineSlotsUsed,
      machineSlotsAvailable,
    )
  }

  function canAddToShelf(
    key: string,
    material: MaterialState,
    quantity: number,
  ): boolean {
    const clone = cloneMaterials(shelfMaterials)
    addMaterial(
      clone,
      key,
      material.kind,
      quantity,
      material.stackCapacity,
    )
    return (
      materialSlots(clone) <= capacitySummary.shelfSlotCapacity
    )
  }

  function moveShelfToBackpack(
    key: string,
    quantity: number,
    machineSlotsUsed = 0,
    machineSlotsAvailable = 0,
  ): boolean {
    const source = shelfMaterials.get(key)
    if (!source || source.quantity < quantity || quantity <= 0) {
      return false
    }

    const current = materialQuantity(backpackMaterials, key)
    const extraCapacity = availableAdditionalQuantity(
      current,
      source.stackCapacity,
      backpackFreeSlots(currentSnapshot()),
    )
    if (quantity > extraCapacity) return false

    removeMaterial(shelfMaterials, key, quantity)
    addMaterial(
      backpackMaterials,
      key,
      source.kind,
      quantity,
      source.stackCapacity,
    )
    pushAction(
      'move-shelf-to-backpack',
      `${materialLabel(key)} ×${quantity}：一般架 → 背包`,
      quantity,
      currentSnapshot(machineSlotsUsed, machineSlotsAvailable),
    )
    return true
  }

  function moveBackpackToShelf(
    key: string,
    quantity: number,
    machineSlotsUsed = 0,
    machineSlotsAvailable = 0,
  ): boolean {
    const source = backpackMaterials.get(key)
    if (!source || source.quantity < quantity || quantity <= 0) {
      return false
    }
    if (!canAddToShelf(key, source, quantity)) return false

    removeMaterial(backpackMaterials, key, quantity)
    addMaterial(
      shelfMaterials,
      key,
      source.kind,
      quantity,
      source.stackCapacity,
    )
    pushAction(
      'move-backpack-to-shelf',
      `${materialLabel(key)} ×${quantity}：背包 → 一般架`,
      quantity,
      currentSnapshot(machineSlotsUsed, machineSlotsAvailable),
    )
    return true
  }

  function freeBackpackSlots(
    slotsNeeded: number,
    protectedKeys: Set<string>,
    machineSlotsUsed = 0,
    machineSlotsAvailable = 0,
  ): boolean {
    let remaining = slotsNeeded

    while (remaining > 0) {
      const candidate = [...backpackMaterials.entries()]
        .filter(([key]) => !protectedKeys.has(key))
        .sort(([leftKey, left], [rightKey, right]) => {
          const kindWeight: Record<MaterialKind, number> = {
            raw: 0,
            water: 1,
            intermediate: 2,
          }
          return (
            kindWeight[left.kind] - kindWeight[right.kind] ||
            right.quantity - left.quantity ||
            leftKey.localeCompare(rightKey)
          )
        })
        .find(([key, material]) => {
          const moveQuantity = quantityToFreeOneStack(
            material.quantity,
            material.stackCapacity,
          )
          return canAddToShelf(key, material, moveQuantity)
        })

      if (!candidate) return false
      const [key, material] = candidate
      const moveQuantity = quantityToFreeOneStack(
        material.quantity,
        material.stackCapacity,
      )
      if (
        !moveBackpackToShelf(
          key,
          moveQuantity,
          machineSlotsUsed,
          machineSlotsAvailable,
        )
      ) {
        return false
      }
      remaining -= 1
    }

    return true
  }

  function ensureBackpackCapacityForAddition(
    key: string,
    amount: number,
    stackCapacity: number,
    protectedKeys: Set<string>,
    machineSlotsUsed = 0,
    machineSlotsAvailable = 0,
  ): boolean {
    if (amount <= 0) return true
    const current = materialQuantity(backpackMaterials, key)
    const beforeSlots = stackCount(current, stackCapacity)
    const afterSlots = stackCount(current + amount, stackCapacity)
    const extraSlots = Math.max(0, afterSlots - beforeSlots)
    const freeSlots = backpackFreeSlots(currentSnapshot())
    if (extraSlots <= freeSlots) return true

    return freeBackpackSlots(
      extraSlots - freeSlots,
      new Set([...protectedKeys, key]),
      machineSlotsUsed,
      machineSlotsAvailable,
    )
  }

  function acquireExternalRaw(
    key: string,
    quantity: number,
    machineSlotsUsed = 0,
    machineSlotsAvailable = 0,
  ): boolean {
    if (quantity <= 0) return true
    if (
      !ensureBackpackCapacityForAddition(
        key,
        quantity,
        PROCESSING_STACK_CAPACITY,
        new Set([key]),
        machineSlotsUsed,
        machineSlotsAvailable,
      )
    ) {
      return false
    }

    addMaterial(
      backpackMaterials,
      key,
      'raw',
      quantity,
      PROCESSING_STACK_CAPACITY,
    )
    ingredientAcquisitionActions += 1
    pushAction(
      'acquire-ingredient',
      `取得 ${materialLabel(key)} ×${quantity} → 背包`,
      quantity,
      currentSnapshot(machineSlotsUsed, machineSlotsAvailable),
    )
    return true
  }

  function fetchExternalWater(
    quantity: number,
    machineSlotsUsed = 0,
    machineSlotsAvailable = 0,
  ): boolean {
    if (quantity <= 0) return true
    if (externalWaterRemaining < quantity) return false
    if (
      !ensureBackpackCapacityForAddition(
        'water',
        quantity,
        WATER_STACK_CAPACITY,
        new Set(['water']),
        machineSlotsUsed,
        machineSlotsAvailable,
      )
    ) {
      return false
    }

    addMaterial(
      backpackMaterials,
      'water',
      'water',
      quantity,
      WATER_STACK_CAPACITY,
    )
    externalWaterRemaining -= quantity
    waterFetchTrips += 1
    pushAction(
      'fetch-water',
      `取水 ×${quantity} → 背包`,
      quantity,
      currentSnapshot(machineSlotsUsed, machineSlotsAvailable),
    )
    return true
  }

  function ensureBackpackQuantity(
    key: string,
    quantity: number,
    kind: MaterialKind,
    stackCapacity: number,
    protectedKeys: Set<string>,
    allowExternal: boolean,
    machineSlotsUsed = 0,
    machineSlotsAvailable = 0,
  ): boolean {
    if (materialQuantity(backpackMaterials, key) >= quantity) {
      return true
    }

    let missing =
      quantity - materialQuantity(backpackMaterials, key)
    const onShelf = materialQuantity(shelfMaterials, key)
    const fromShelf = Math.min(onShelf, missing)

    if (fromShelf > 0) {
      if (
        !ensureBackpackCapacityForAddition(
          key,
          fromShelf,
          stackCapacity,
          protectedKeys,
          machineSlotsUsed,
          machineSlotsAvailable,
        )
      ) {
        return false
      }
      if (
        !moveShelfToBackpack(
          key,
          fromShelf,
          machineSlotsUsed,
          machineSlotsAvailable,
        )
      ) {
        return false
      }
      missing =
        quantity - materialQuantity(backpackMaterials, key)
    }

    if (missing <= 0) return true
    if (!allowExternal) return false

    if (kind === 'water') {
      return fetchExternalWater(
        missing,
        machineSlotsUsed,
        machineSlotsAvailable,
      )
    }
    if (kind === 'raw') {
      return acquireExternalRaw(
        key,
        missing,
        machineSlotsUsed,
        machineSlotsAvailable,
      )
    }
    return false
  }

  function tryPreloadPrimaryRequirement(
    requirement: PrimaryInputRequirement,
  ) {
    const current = materialQuantity(
      backpackMaterials,
      requirement.key,
    )
    if (current >= requirement.quantity) return

    let remaining = requirement.quantity - current
    const snapshot = currentSnapshot()
    const addCapacity = availableAdditionalQuantity(
      current,
      requirement.stackCapacity,
      backpackFreeSlots(snapshot),
    )
    if (addCapacity <= 0) return

    let allowance = Math.min(remaining, addCapacity)
    const shelfQuantity = materialQuantity(
      shelfMaterials,
      requirement.key,
    )
    const fromShelf = Math.min(shelfQuantity, allowance)

    if (fromShelf > 0) {
      if (!moveShelfToBackpack(requirement.key, fromShelf)) {
        return
      }
      allowance -= fromShelf
      remaining -= fromShelf
    }

    if (allowance <= 0 || remaining <= 0) return
    const externalQuantity = Math.min(allowance, remaining)

    if (requirement.kind === 'water') {
      const fetchQuantity = Math.min(
        externalQuantity,
        externalWaterRemaining,
      )
      if (fetchQuantity > 0) {
        fetchExternalWater(fetchQuantity)
      }
      return
    }

    acquireExternalRaw(requirement.key, externalQuantity)
  }

  function preloadPrimaryInputs(operations: PendingOperation[]) {
    for (const requirement of primaryInputRequirements(operations)) {
      tryPreloadPrimaryRequirement(requirement)
    }
  }

  // Opportunistically preload every remaining primary input that currently
  // fits. When the backpack can hold the full production round this puts all
  // raw ingredients and water in the backpack before the first machine run.
  // If it cannot, later operation attempts replenish only after machine inputs
  // have been loaded and their backpack slots have been freed.
  if (issues.length === 0) {
    preloadPrimaryInputs(pending)
  }

  let guard = 0
  while (pending.length > 0 && issues.length === 0) {
    guard += 1
    if (guard > 10000) {
      issues.push('製作物流排程超過安全迭代上限，已停止規劃。')
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
        !canRunWithCurrentIntermediateStock(
          operation,
          shelfMaterials,
          backpackMaterials,
        )
      ) {
        continue
      }

      const shelfBefore = cloneMaterials(shelfMaterials)
      const backpackBefore = cloneMaterials(backpackMaterials)
      const actionsLengthBefore = actions.length
      const ingredientAcquisitionActionsBefore =
        ingredientAcquisitionActions
      const waterFetchTripsBefore = waterFetchTrips
      const externalWaterRemainingBefore = externalWaterRemaining

      const rollbackOperationAttempt = () => {
        replaceMaterials(shelfMaterials, shelfBefore)
        replaceMaterials(backpackMaterials, backpackBefore)
        actions.splice(actionsLengthBefore)
        ingredientAcquisitionActions =
          ingredientAcquisitionActionsBefore
        waterFetchTrips = waterFetchTripsBefore
        externalWaterRemaining = externalWaterRemainingBefore
      }

      const machineSlotsAvailable = equipmentSlotCapacity(step.kind)
      let preloadedMachineSlots = 0
      const protectedKeys = new Set<string>()

      if (step.kind === 'juicing') {
        const ingredientId = step.addedIngredientId
        if (!ingredientId) {
          rollbackOperationAttempt()
          continue
        }
        const key = rawKey(ingredientId)
        protectedKeys.add(key)
        if (
          !ensureBackpackQuantity(
            key,
            quantity,
            'raw',
            PROCESSING_STACK_CAPACITY,
            protectedKeys,
            true,
          )
        ) {
          rollbackOperationAttempt()
          continue
        }
        removeMaterial(backpackMaterials, key, quantity)
      } else {
        const requirements = intermediateRequirements(operation)
        for (const key of requirements.keys()) {
          protectedKeys.add(key)
        }

        let inputsReady = true
        for (const [key, required] of requirements) {
          if (
            !ensureBackpackQuantity(
              key,
              required,
              'intermediate',
              PROCESSING_STACK_CAPACITY,
              protectedKeys,
              false,
              preloadedMachineSlots,
              machineSlotsAvailable,
            )
          ) {
            inputsReady = false
            break
          }
          removeMaterial(backpackMaterials, key, required)
          preloadedMachineSlots += 1
        }
        if (!inputsReady) {
          rollbackOperationAttempt()
          continue
        }

        if (step.kind === 'seasoning') {
          const ingredientId = step.addedIngredientId
          if (!ingredientId) {
            rollbackOperationAttempt()
            continue
          }
          const key = rawKey(ingredientId)
          protectedKeys.add(key)
          if (
            !ensureBackpackQuantity(
              key,
              quantity,
              'raw',
              PROCESSING_STACK_CAPACITY,
              protectedKeys,
              true,
              preloadedMachineSlots,
              machineSlotsAvailable,
            )
          ) {
            rollbackOperationAttempt()
            continue
          }
          removeMaterial(backpackMaterials, key, quantity)
        } else if (step.kind === 'finalizing') {
          protectedKeys.add('water')
          if (
            !ensureBackpackQuantity(
              'water',
              quantity,
              'water',
              WATER_STACK_CAPACITY,
              protectedKeys,
              true,
              preloadedMachineSlots,
              machineSlotsAvailable,
            )
          ) {
            rollbackOperationAttempt()
            continue
          }
          removeMaterial(backpackMaterials, 'water', quantity)
        }
      }

      const loadedSnapshot = currentSnapshot(
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

      const outputSnapshot = currentSnapshot(
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
        const receiverFill = operation.receiverFill
        if (!receiverFill) {
          rollbackOperationAttempt()
          continue
        }
        if (receiverFill.servings !== quantity * 2) {
          rollbackOperationAttempt()
          continue
        }

        pushAction(
          'handoff-finished',
          `第 ${receiverFill.beforeTripNumber} 趟前：成品 ×${receiverFill.servings} → ${receiverFill.physicalJarId}（${receiverFill.recipeName}）`,
          receiverFill.servings,
          currentSnapshot(),
          step.equipment,
          receiverFill.receiver,
          receiverFill,
        )
      } else {
        const outputKey = intermediateKey(step.toIngredientIds)
        if (
          !ensureBackpackCapacityForAddition(
            outputKey,
            quantity,
            PROCESSING_STACK_CAPACITY,
            new Set([outputKey]),
            1,
            machineSlotsAvailable,
          )
        ) {
          rollbackOperationAttempt()
          continue
        }

        addMaterial(
          backpackMaterials,
          outputKey,
          'intermediate',
          quantity,
          PROCESSING_STACK_CAPACITY,
        )
        pushAction(
          'unload-intermediate',
          `${sequenceLabel(step.toIngredientIds)} ×${quantity}：機器 → 背包`,
          quantity,
          currentSnapshot(),
          step.equipment,
        )
      }

      const pendingIndex = pending.findIndex(
        (item) => item.id === operation.id,
      )
      pending.splice(pendingIndex, 1)
      executed = true

      // Fill newly freed backpack capacity with as much of the remaining
      // production round as possible before choosing the next machine step.
      preloadPrimaryInputs(pending)
      break
    }

    if (!executed) {
      const finalizerReadyWithoutReceiver = pending.some(
        (operation) =>
          operation.step.kind === 'finalizing' &&
          canRunWithCurrentIntermediateStock(
            operation,
            shelfMaterials,
            backpackMaterials,
          ),
      )

      issues.push(
        finalizerReadyWithoutReceiver
          ? '果汁成品台輸出無法依販售排程指定的實體果汁罐時序完成裝罐；請檢查接收罐內容、容量與可用時點。'
          : '目前背包／一般架容量不足，無法在不使用地面暫存的前提下完成下一個製作操作。',
      )
    }
  }

  const finalSnapshot = currentSnapshot()

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
