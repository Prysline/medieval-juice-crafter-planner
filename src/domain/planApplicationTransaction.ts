import type {
  InventoryState,
  PlannerSettings,
  ProgressMilestoneId,
  SatisfactionByVillage,
} from '../types'
import type { OptimizationResult } from './optimizer'
import type { PreparationShortfall } from './preparationShortfall'
import type {
  MultiTripDiscardedInitialJuice,
  MultiTripDiscardedNewProductionJuice,
  MultiTripLeftoverJarContent,
  MultiTripReplenishmentPlan,
} from './multiTripReplenishment'
import type { ProductionLogisticsPlan } from './productionLogistics'

export const PLAN_APPLICATION_TRANSACTION_SCHEMA =
  'plan-application-v1' as const

export interface PlanApplicationJarSnapshot {
  readonly id: string
  readonly recipeId: string | null
  readonly servings: number
}

export interface PlanApplicationInventorySnapshot {
  readonly ingredientUnits: Readonly<Record<string, number>>
  readonly waterUnits: number
  readonly cleanCups: number
  readonly usedCups: number
  readonly juiceJars: readonly PlanApplicationJarSnapshot[]
  readonly shelfCount: number
  readonly jarRackCount: number
}

export interface PlanApplicationSettingsSnapshot {
  readonly juiceJarCarryMode: PlannerSettings['juiceJarCarryMode']
  readonly reservedJuiceJarSlots: number
  readonly allowUsedCupDropIfFull: boolean
  readonly allowDiscardRetainedJuice: boolean
}

export interface PlanApplicationStateSnapshot {
  readonly inventory: PlanApplicationInventorySnapshot
  readonly currentProgress: ProgressMilestoneId
  readonly satisfactionByVillage: Readonly<SatisfactionByVillage>
  readonly formalCustomerIds: readonly string[]
  readonly suppliedCustomerIds: readonly string[]
  readonly plannerSettings: PlanApplicationSettingsSnapshot
}

export interface IngredientTransactionChange {
  readonly ingredientId: string
  readonly beforeUnits: number
  readonly afterUnits: number
  readonly consumedFromInventory: number
  readonly acquiredAndConsumedUnits: number
}

export interface WaterTransactionChange {
  readonly beforeUnits: number
  readonly afterUnits: number
  readonly consumedFromInventory: number
  readonly productionUnitsRequired: number
  readonly cupWashUnitsRequired: number
  readonly externalUnitsRequired: number
}

export interface CupTransactionChange {
  readonly cleanBefore: number
  readonly cleanAfter: number
  readonly usedBefore: number
  readonly usedAfter: number
  readonly physicalBefore: number
  readonly physicalAfter: number
  readonly droppedUsedCups: number
}

export interface JuiceJarTransactionChange {
  readonly physicalJarId: string
  readonly before: PlanApplicationJarSnapshot
  readonly after: PlanApplicationJarSnapshot
}

export interface DiscardedJuiceTransactionChange {
  readonly source: 'initial-contents' | 'new-production-leftover'
  readonly physicalJarId: string
  readonly recipeId: string
  readonly servings: number
  readonly afterTripNumber?: number
}

export interface PlanApplicationTransactionChanges {
  readonly ingredients: readonly IngredientTransactionChange[]
  readonly water: WaterTransactionChange
  readonly cups: CupTransactionChange
  readonly juiceJars: readonly JuiceJarTransactionChange[]
  readonly discardedJuice: readonly DiscardedJuiceTransactionChange[]
  readonly newlySuppliedCustomerIds: readonly string[]
}

export interface PlanApplicationTransactionDraft {
  readonly schemaVersion: typeof PLAN_APPLICATION_TRANSACTION_SCHEMA
  readonly before: PlanApplicationStateSnapshot
  readonly after: PlanApplicationStateSnapshot
  readonly changes: PlanApplicationTransactionChanges
}

export interface PlanApplicationBasisState {
  inventory: InventoryState
  currentProgress: ProgressMilestoneId
  satisfactionByVillage: SatisfactionByVillage
  formalCustomerIds: string[]
  suppliedCustomerIds: string[]
  plannerSettings: PlannerSettings
}

export interface BuildPlanApplicationTransactionInput {
  basis: PlanApplicationBasisState
  result: OptimizationResult
  preparationShortfall: PreparationShortfall
  productionLogistics: ProductionLogisticsPlan
  salesPlan: MultiTripReplenishmentPlan
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function duplicateValue(values: string[]): string | null {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return null
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const aSorted = [...a].sort()
  const bSorted = [...b].sort()
  return aSorted.every((value, index) => value === bSorted[index])
}

function cloneJar(
  jar: PlanApplicationJarSnapshot,
): PlanApplicationJarSnapshot {
  return {
    id: jar.id,
    recipeId: jar.recipeId,
    servings: jar.servings,
  }
}

function snapshotInventory(
  inventory: InventoryState,
): PlanApplicationInventorySnapshot {
  return {
    ingredientUnits: { ...inventory.ingredientUnits },
    waterUnits: inventory.waterUnits,
    cleanCups: inventory.cleanCups,
    usedCups: inventory.usedCups,
    juiceJars: inventory.juiceJars.map((jar) => cloneJar(jar)),
    shelfCount: inventory.shelfCount,
    jarRackCount: inventory.jarRackCount,
  }
}

function snapshotState(
  basis: PlanApplicationBasisState,
  inventory: PlanApplicationInventorySnapshot,
  suppliedCustomerIds: string[],
): PlanApplicationStateSnapshot {
  return {
    inventory,
    currentProgress: basis.currentProgress,
    satisfactionByVillage: { ...basis.satisfactionByVillage },
    formalCustomerIds: [...basis.formalCustomerIds],
    suppliedCustomerIds: [...suppliedCustomerIds],
    plannerSettings: {
      juiceJarCarryMode: basis.plannerSettings.juiceJarCarryMode,
      reservedJuiceJarSlots:
        basis.plannerSettings.reservedJuiceJarSlots,
      allowUsedCupDropIfFull:
        basis.plannerSettings.allowUsedCupDropIfFull,
      allowDiscardRetainedJuice:
        basis.plannerSettings.allowDiscardRetainedJuice,
    },
  }
}

function freezeInventorySnapshot(
  snapshot: PlanApplicationInventorySnapshot,
): PlanApplicationInventorySnapshot {
  Object.freeze(snapshot.ingredientUnits)
  snapshot.juiceJars.forEach((jar) => Object.freeze(jar))
  Object.freeze(snapshot.juiceJars)
  return Object.freeze(snapshot)
}

function freezeStateSnapshot(
  snapshot: PlanApplicationStateSnapshot,
): PlanApplicationStateSnapshot {
  freezeInventorySnapshot(snapshot.inventory)
  Object.freeze(snapshot.satisfactionByVillage)
  Object.freeze(snapshot.formalCustomerIds)
  Object.freeze(snapshot.suppliedCustomerIds)
  Object.freeze(snapshot.plannerSettings)
  return Object.freeze(snapshot)
}

function freezeChanges(
  changes: PlanApplicationTransactionChanges,
): PlanApplicationTransactionChanges {
  changes.ingredients.forEach((change) => Object.freeze(change))
  Object.freeze(changes.ingredients)
  Object.freeze(changes.water)
  Object.freeze(changes.cups)
  changes.juiceJars.forEach((change) => {
    Object.freeze(change.before)
    Object.freeze(change.after)
    Object.freeze(change)
  })
  Object.freeze(changes.juiceJars)
  changes.discardedJuice.forEach((change) => Object.freeze(change))
  Object.freeze(changes.discardedJuice)
  Object.freeze(changes.newlySuppliedCustomerIds)
  return Object.freeze(changes)
}

function validatePlanBasis(
  input: BuildPlanApplicationTransactionInput,
): void {
  const {
    basis,
    result,
    preparationShortfall,
    productionLogistics,
    salesPlan,
  } = input

  if (!productionLogistics.feasible) {
    throw new Error(
      'Cannot build an application transaction from an infeasible production logistics plan',
    )
  }

  if (
    salesPlan.initialCleanCups !== basis.inventory.cleanCups ||
    salesPlan.initialUsedCups !== basis.inventory.usedCups ||
    salesPlan.initialPhysicalCupCount !==
      basis.inventory.cleanCups + basis.inventory.usedCups
  ) {
    throw new Error(
      'Sales plan cup inventory does not match the transaction basis',
    )
  }

  if (
    salesPlan.finalCleanCups + salesPlan.finalUsedCups !==
      salesPlan.finalPhysicalCupCount ||
    salesPlan.finalPhysicalCupCount !==
      salesPlan.initialPhysicalCupCount - salesPlan.droppedUsedCups
  ) {
    throw new Error(
      'Sales plan final cup state does not conserve physical cups',
    )
  }

  const expectedPolicy = basis.plannerSettings.allowUsedCupDropIfFull
    ? 'allow-drop-if-full'
    : 'retain-and-wash'
  if (salesPlan.policy !== expectedPolicy) {
    throw new Error(
      'Sales plan cup policy does not match the transaction basis',
    )
  }
  if (
    salesPlan.allowDiscardRetainedJuice !==
    basis.plannerSettings.allowDiscardRetainedJuice
  ) {
    throw new Error(
      'Sales plan retained-juice discard policy does not match the transaction basis',
    )
  }
  if (
    !salesPlan.allowDiscardRetainedJuice &&
    (
      salesPlan.discardedInitialJuice.length > 0 ||
      salesPlan.discardedNewProductionJuice.length > 0
    )
  ) {
    throw new Error(
      'Sales plan cannot discard juice without explicit opt-in',
    )
  }

  if (
    preparationShortfall.waterUnitsAvailable !==
    basis.inventory.waterUnits
  ) {
    throw new Error(
      'Preparation water inventory does not match the transaction basis',
    )
  }

  if (
    preparationShortfall.cleanCupsAvailable !==
      basis.inventory.cleanCups ||
    preparationShortfall.usedCupsAvailable !==
      basis.inventory.usedCups
  ) {
    throw new Error(
      'Preparation cup inventory does not match the transaction basis',
    )
  }

  const inventoryJarById = new Map(
    basis.inventory.juiceJars.map((jar) => [jar.id, jar]),
  )
  for (const discarded of salesPlan.discardedInitialJuice) {
    const jar = inventoryJarById.get(discarded.physicalJarId)
    if (!jar) {
      throw new Error(
        `Discarded juice references missing physical jar ${discarded.physicalJarId}`,
      )
    }
    if (
      jar.recipeId !== discarded.recipeId ||
      discarded.servings < 1 ||
      discarded.servings > jar.servings
    ) {
      throw new Error(
        `Discarded juice does not match initial contents for physical jar ${discarded.physicalJarId}`,
      )
    }
  }

  const shortfallByRecipeId = new Map(
    preparationShortfall.recipes.map((recipe) => [
      recipe.recipeId,
      recipe,
    ]),
  )
  const discardedNewByRecipeId = new Map<string, number>()
  for (const discarded of salesPlan.discardedNewProductionJuice) {
    const recipe = shortfallByRecipeId.get(discarded.recipeId)
    if (!recipe) {
      throw new Error(
        `Discarded new-production juice references unknown recipe ${discarded.recipeId}`,
      )
    }
    if (
      discarded.servings < 1 ||
      discarded.afterTripNumber < 1 ||
      discarded.afterTripNumber > salesPlan.trips.length
    ) {
      throw new Error(
        `Discarded new-production juice has invalid timing or quantity for ${discarded.recipeId}`,
      )
    }

    const trip = salesPlan.trips.find(
      (item) => item.tripNumber === discarded.afterTripNumber,
    )
    const matchingLoad = trip?.juiceJars.find(
      (load) =>
        load.physicalJarId === discarded.physicalJarId &&
        load.recipeId === discarded.recipeId,
    )
    if (!matchingLoad) {
      throw new Error(
        `Discarded new-production juice does not match a physical sales load for ${discarded.recipeId}`,
      )
    }

    discardedNewByRecipeId.set(
      discarded.recipeId,
      (discardedNewByRecipeId.get(discarded.recipeId) ?? 0) +
        discarded.servings,
    )
  }
  for (const [recipeId, servings] of discardedNewByRecipeId) {
    const recipe = shortfallByRecipeId.get(recipeId)
    if (
      !recipe ||
      servings > recipe.newProductionLeftoverServings
    ) {
      throw new Error(
        `Discarded new-production juice exceeds produced leftovers for ${recipeId}`,
      )
    }
  }

  for (const carried of salesPlan.carriedJuiceJars) {
    const jar = inventoryJarById.get(carried.physicalJarId)
    if (!jar) {
      throw new Error(
        `Sales plan references missing physical jar ${carried.physicalJarId}`,
      )
    }
    if (
      jar.recipeId !== carried.initialRecipeId ||
      jar.servings !== carried.initialServings
    ) {
      throw new Error(
        `Sales plan initial contents do not match physical jar ${carried.physicalJarId}`,
      )
    }
  }

  for (const ingredient of preparationShortfall.ingredients) {
    const beforeUnits =
      basis.inventory.ingredientUnits[ingredient.ingredientId] ?? 0
    if (ingredient.inventoryUnitsAvailable !== beforeUnits) {
      throw new Error(
        `Preparation ingredient inventory does not match ${ingredient.ingredientId}`,
      )
    }
    if (ingredient.inventoryUnitsUsed > beforeUnits) {
      throw new Error(
        `Preparation ingredient usage exceeds inventory for ${ingredient.ingredientId}`,
      )
    }
  }

  const assignedCustomerIds = result.assignments.map(
    (assignment) => assignment.customerId,
  )
  if (result.assignedServings !== assignedCustomerIds.length) {
    throw new Error(
      'Optimization assignment count does not match its result summary',
    )
  }

  const duplicateAssigned = duplicateValue(assignedCustomerIds)
  if (duplicateAssigned) {
    throw new Error(
      `Optimization result assigns customer ${duplicateAssigned} more than once`,
    )
  }

  const alreadySupplied = new Set(basis.suppliedCustomerIds)
  const reassignedCustomerId = assignedCustomerIds.find((id) =>
    alreadySupplied.has(id),
  )
  if (reassignedCustomerId) {
    throw new Error(
      `Optimization result includes already supplied customer ${reassignedCustomerId}`,
    )
  }

  const scheduledCustomerIds = salesPlan.trips.flatMap((trip) =>
    trip.juiceJars.flatMap((load) => load.customerIds),
  )
  const duplicateScheduled = duplicateValue(scheduledCustomerIds)
  if (duplicateScheduled) {
    throw new Error(
      `Sales plan serves customer ${duplicateScheduled} more than once`,
    )
  }

  if (
    salesPlan.totalAssignedServings !== assignedCustomerIds.length ||
    !sameStringSet(assignedCustomerIds, scheduledCustomerIds)
  ) {
    throw new Error(
      'Sales plan customers do not match optimization assignments',
    )
  }

  const shortfallAssigned = preparationShortfall.recipes.reduce(
    (sum, recipe) => sum + recipe.assignedServings,
    0,
  )
  if (shortfallAssigned !== assignedCustomerIds.length) {
    throw new Error(
      'Preparation shortfall does not match optimization assignments',
    )
  }

  const plannedLeftovers = salesPlan.leftoverJarContents.reduce(
    (sum, leftover) => sum + leftover.servings,
    0,
  )
  if (plannedLeftovers !== salesPlan.totalLeftoverServings) {
    throw new Error(
      'Sales plan leftover summary does not match terminal jar contents',
    )
  }

  const newlyProducedServings = preparationShortfall.recipes.reduce(
    (sum, recipe) => sum + recipe.newlyProducedServings,
    0,
  )
  const scheduledProductionFills = salesPlan.productionJarFills.reduce(
    (sum, fill) => sum + fill.servings,
    0,
  )
  if (newlyProducedServings !== scheduledProductionFills) {
    throw new Error(
      'Sales jar production fills do not match preparation output',
    )
  }
}

function buildIngredientTransaction(
  shortfall: PreparationShortfall,
  before: PlanApplicationInventorySnapshot,
): {
  ingredientUnits: Record<string, number>
  changes: IngredientTransactionChange[]
} {
  const ingredientUnits = { ...before.ingredientUnits }
  const changes = shortfall.ingredients
    .map((ingredient): IngredientTransactionChange => {
      const beforeUnits =
        before.ingredientUnits[ingredient.ingredientId] ?? 0
      const afterUnits =
        beforeUnits - ingredient.inventoryUnitsUsed

      if (afterUnits > 0) {
        ingredientUnits[ingredient.ingredientId] = afterUnits
      } else {
        delete ingredientUnits[ingredient.ingredientId]
      }

      return {
        ingredientId: ingredient.ingredientId,
        beforeUnits,
        afterUnits,
        consumedFromInventory: ingredient.inventoryUnitsUsed,
        acquiredAndConsumedUnits: ingredient.purchaseUnits,
      }
    })
    .sort((a, b) =>
      a.ingredientId.localeCompare(b.ingredientId),
    )

  return { ingredientUnits, changes }
}

function finalJarContents(
  before: PlanApplicationInventorySnapshot,
  salesPlan: MultiTripReplenishmentPlan,
): PlanApplicationJarSnapshot[] {
  const jarById = new Map(
    before.juiceJars.map((jar) => [jar.id, cloneJar(jar)]),
  )

  for (const discarded of salesPlan.discardedInitialJuice) {
    const jar = jarById.get(discarded.physicalJarId)
    if (!jar) {
      throw new Error(
        `Discarded juice references missing physical jar ${discarded.physicalJarId}`,
      )
    }
    const remainingServings = jar.servings - discarded.servings
    jarById.set(discarded.physicalJarId, {
      id: jar.id,
      recipeId:
        remainingServings > 0 ? jar.recipeId : null,
      servings: Math.max(0, remainingServings),
    })
  }

  const usedJarIds = new Set(
    salesPlan.trips.flatMap((trip) =>
      trip.juiceJars.map((load) => load.physicalJarId),
    ),
  )

  for (const id of usedJarIds) {
    const jar = jarById.get(id)
    if (!jar) {
      throw new Error(
        `Sales plan uses missing physical jar ${id}`,
      )
    }
    jarById.set(id, {
      id,
      recipeId: null,
      servings: 0,
    })
  }

  const leftoverByJarId = new Map<
    string,
    MultiTripLeftoverJarContent
  >()
  for (const leftover of salesPlan.leftoverJarContents) {
    if (!usedJarIds.has(leftover.physicalJarId)) {
      throw new Error(
        `Leftover contents reference unused physical jar ${leftover.physicalJarId}`,
      )
    }
    if (leftoverByJarId.has(leftover.physicalJarId)) {
      throw new Error(
        `Sales plan has multiple terminal leftovers for physical jar ${leftover.physicalJarId}`,
      )
    }
    if (leftover.servings < 1 || leftover.servings > 10) {
      throw new Error(
        `Sales plan has invalid leftover quantity for physical jar ${leftover.physicalJarId}`,
      )
    }
    leftoverByJarId.set(leftover.physicalJarId, leftover)
    jarById.set(leftover.physicalJarId, {
      id: leftover.physicalJarId,
      recipeId: leftover.recipeId,
      servings: leftover.servings,
    })
  }

  return before.juiceJars.map((jar) => {
    const after = jarById.get(jar.id)
    if (!after) {
      throw new Error(
        `Transaction lost physical jar identity ${jar.id}`,
      )
    }
    return cloneJar(after)
  })
}

function buildJarChanges(
  before: readonly PlanApplicationJarSnapshot[],
  after: readonly PlanApplicationJarSnapshot[],
): JuiceJarTransactionChange[] {
  const afterById = new Map(after.map((jar) => [jar.id, jar]))

  return before.flatMap((beforeJar) => {
    const afterJar = afterById.get(beforeJar.id)
    if (!afterJar) {
      throw new Error(
        `Transaction output is missing physical jar ${beforeJar.id}`,
      )
    }

    if (
      beforeJar.recipeId === afterJar.recipeId &&
      beforeJar.servings === afterJar.servings
    ) {
      return []
    }

    return [{
      physicalJarId: beforeJar.id,
      before: cloneJar(beforeJar),
      after: cloneJar(afterJar),
    }]
  })
}

export function buildPlanApplicationTransactionDraft(
  input: BuildPlanApplicationTransactionInput,
): PlanApplicationTransactionDraft {
  validatePlanBasis(input)

  const {
    basis,
    result,
    preparationShortfall,
    salesPlan,
  } = input
  const beforeInventory = snapshotInventory(basis.inventory)
  const ingredientTransaction = buildIngredientTransaction(
    preparationShortfall,
    beforeInventory,
  )

  const totalWaterUnitsRequired =
    preparationShortfall.productionWaterUnitsRequired +
    salesPlan.totalCupWashWaterUnits
  const waterConsumedFromInventory = Math.min(
    beforeInventory.waterUnits,
    totalWaterUnitsRequired,
  )
  const afterWaterUnits =
    beforeInventory.waterUnits - waterConsumedFromInventory

  const afterJars = finalJarContents(
    beforeInventory,
    salesPlan,
  )
  const afterInventory: PlanApplicationInventorySnapshot = {
    ...beforeInventory,
    ingredientUnits: ingredientTransaction.ingredientUnits,
    waterUnits: afterWaterUnits,
    cleanCups: salesPlan.finalCleanCups,
    usedCups: salesPlan.finalUsedCups,
    juiceJars: afterJars,
  }

  const beforeSuppliedCustomerIds = unique(
    basis.suppliedCustomerIds,
  )
  const assignedCustomerIds = result.assignments.map(
    (assignment) => assignment.customerId,
  )
  const suppliedSet = new Set(beforeSuppliedCustomerIds)
  const newlySuppliedCustomerIds: string[] = []
  for (const customerId of assignedCustomerIds) {
    if (suppliedSet.has(customerId)) continue
    suppliedSet.add(customerId)
    newlySuppliedCustomerIds.push(customerId)
  }
  const afterSuppliedCustomerIds = [
    ...beforeSuppliedCustomerIds,
    ...newlySuppliedCustomerIds,
  ]

  const before = snapshotState(
    basis,
    beforeInventory,
    beforeSuppliedCustomerIds,
  )
  const after = snapshotState(
    basis,
    afterInventory,
    afterSuppliedCustomerIds,
  )
  const changes: PlanApplicationTransactionChanges = {
    ingredients: ingredientTransaction.changes,
    water: {
      beforeUnits: beforeInventory.waterUnits,
      afterUnits: afterWaterUnits,
      consumedFromInventory: waterConsumedFromInventory,
      productionUnitsRequired:
        preparationShortfall.productionWaterUnitsRequired,
      cupWashUnitsRequired: salesPlan.totalCupWashWaterUnits,
      externalUnitsRequired: Math.max(
        0,
        totalWaterUnitsRequired - beforeInventory.waterUnits,
      ),
    },
    cups: {
      cleanBefore: beforeInventory.cleanCups,
      cleanAfter: salesPlan.finalCleanCups,
      usedBefore: beforeInventory.usedCups,
      usedAfter: salesPlan.finalUsedCups,
      physicalBefore:
        beforeInventory.cleanCups + beforeInventory.usedCups,
      physicalAfter: salesPlan.finalPhysicalCupCount,
      droppedUsedCups: salesPlan.droppedUsedCups,
    },
    juiceJars: buildJarChanges(
      beforeInventory.juiceJars,
      afterJars,
    ),
    discardedJuice: [
      ...salesPlan.discardedInitialJuice.map(
        (item: MultiTripDiscardedInitialJuice) => ({
          source: 'initial-contents' as const,
          physicalJarId: item.physicalJarId,
          recipeId: item.recipeId,
          servings: item.servings,
        }),
      ),
      ...salesPlan.discardedNewProductionJuice.map(
        (item: MultiTripDiscardedNewProductionJuice) => ({
          source: 'new-production-leftover' as const,
          physicalJarId: item.physicalJarId,
          recipeId: item.recipeId,
          servings: item.servings,
          afterTripNumber: item.afterTripNumber,
        }),
      ),
    ],
    newlySuppliedCustomerIds,
  }

  const draft: PlanApplicationTransactionDraft = {
    schemaVersion: PLAN_APPLICATION_TRANSACTION_SCHEMA,
    before: freezeStateSnapshot(before),
    after: freezeStateSnapshot(after),
    changes: freezeChanges(changes),
  }

  return Object.freeze(draft)
}
