import type { InventoryState } from '../types'
import {
  BACKPACK_SLOT_CAPACITY,
  CLEAN_CUP_STACK_CAPACITY,
} from './inventoryRules'
import type { PreparationShortfall } from './preparationShortfall'
import type {
  MultiTripDiscardedInitialJuice,
  MultiTripDiscardedNewProductionJuice,
  MultiTripProductionJarFill,
  MultiTripReplenishmentPlan,
  UsedCupTripPolicy,
} from './multiTripReplenishment'

export interface DeliveryExecutionIngredientRequirement {
  ingredientId: string
  units: number
}

export interface DeliveryExecutionCustomer {
  customerId: string
  physicalJarId: string
  recipeId: string
  recipeName: string
}

export interface DeliveryExecutionTrip {
  tripNumber: number
  productionFills: readonly MultiTripProductionJarFill[]
  initialJuiceDiscards: readonly MultiTripDiscardedInitialJuice[]
  ingredientRequirements: readonly DeliveryExecutionIngredientRequirement[]
  productionWaterUnits: number
  cupsWashedBeforeTrip: number
  cupWashWaterUnits: number
  cleanCupsBeforeTrip: number
  usedCupsBeforeTrip: number
  cleanCupsAfterTrip: number
  usedCupsAfterTrip: number
  juiceJarSlotsCarried: number
  deliveries: readonly DeliveryExecutionCustomer[]
  newProductionDiscards: readonly MultiTripDiscardedNewProductionJuice[]
}

export interface DeliveryExecutionPlan {
  planFingerprint: string
  policy: UsedCupTripPolicy
  trips: readonly DeliveryExecutionTrip[]
  finalCleanCups: number
  finalUsedCups: number
  finalPhysicalCupCount: number
}

export interface DeliveryExecutionCursor {
  readonly planFingerprint: string
  readonly nextTripNumber: number
  readonly tripPrepared: boolean
  readonly completedCustomerIdsInTrip: readonly string[]
}

export interface DeliveryExecutionIngredientChange {
  ingredientId: string
  requiredUnits: number
  consumedFromInventory: number
  externalUnitsRequired: number
}

export interface DeliveryExecutionWaterChange {
  requiredUnits: number
  productionUnitsRequired: number
  cupWashUnitsRequired: number
  consumedFromInventory: number
  externalUnitsRequired: number
}

export interface DeliveryExecutionCupChange {
  cleanBefore: number
  cleanAfter: number
  usedBefore: number
  usedAfter: number
  droppedUsedCups: number
}

export interface DeliveryExecutionStepChanges {
  tripPreparedNow: boolean
  ingredients: readonly DeliveryExecutionIngredientChange[]
  water: DeliveryExecutionWaterChange
  initialJuiceDiscards: readonly MultiTripDiscardedInitialJuice[]
  productionFills: readonly MultiTripProductionJarFill[]
  deliveredCustomerId: string
  deliveredPhysicalJarId: string
  deliveredRecipeId: string
  cup: DeliveryExecutionCupChange
  newProductionDiscards: readonly MultiTripDiscardedNewProductionJuice[]
  tripCompleted: boolean
}

export interface DeliveryExecutionStepResult {
  readonly inventory: InventoryState
  readonly cursor: DeliveryExecutionCursor
  readonly changes: DeliveryExecutionStepChanges
}

function cloneInventory(inventory: InventoryState): InventoryState {
  return {
    ...inventory,
    ingredientUnits: { ...inventory.ingredientUnits },
    intermediateJuiceUnits: {
      ...(inventory.intermediateJuiceUnits ?? {}),
    },
    juiceJars: inventory.juiceJars.map((jar) => ({ ...jar })),
  }
}

function cleanCupStacksFor(cups: number): number {
  return Math.ceil(Math.max(0, cups) / CLEAN_CUP_STACK_CAPACITY)
}

function cupProgressAfterDeliveries(
  trip: DeliveryExecutionTrip,
  policy: UsedCupTripPolicy,
  servedCount: number,
): { returnedUsedCups: number; droppedUsedCups: number } {
  const target = Math.max(
    0,
    Math.min(trip.deliveries.length, Math.floor(servedCount)),
  )
  let carriedCleanCups = trip.deliveries.length
  let returnedUsedCups = 0
  let droppedUsedCups = 0

  for (let served = 0; served < target; served += 1) {
    carriedCleanCups -= 1
    const returnedCupCount = returnedUsedCups + 1
    const cupSlotsIfReturned =
      cleanCupStacksFor(carriedCleanCups) +
      cleanCupStacksFor(returnedCupCount)

    if (
      trip.juiceJarSlotsCarried + cupSlotsIfReturned <=
      BACKPACK_SLOT_CAPACITY
    ) {
      returnedUsedCups = returnedCupCount
    } else if (policy === 'allow-drop-if-full') {
      droppedUsedCups += 1
    } else {
      throw new Error(
        `Delivery execution trace cannot return cup ${served + 1} in trip ${trip.tripNumber}`,
      )
    }
  }

  return { returnedUsedCups, droppedUsedCups }
}

function normalizedPlanPayload(
  shortfall: PreparationShortfall,
  salesPlan: MultiTripReplenishmentPlan,
) {
  return {
    policy: salesPlan.policy,
    carriedJuiceJars: salesPlan.carriedJuiceJars.map((jar) => ({
      ...jar,
    })),
    trips: salesPlan.trips.map((trip) => ({
      tripNumber: trip.tripNumber,
      juiceJarSlotsCarried: trip.juiceJarSlotsCarried,
      cupsWashedBeforeTrip: trip.cupsWashedBeforeTrip,
      cupWashWaterUnits: trip.cupWashWaterUnits,
      cleanCupsBeforeTrip: trip.cleanCupsBeforeTrip,
      usedCupsBeforeTrip: trip.usedCupsBeforeTrip,
      cleanCupsAfterTrip: trip.cleanCupsAfterTrip,
      usedCupsAfterTrip: trip.usedCupsAfterTrip,
      droppedUsedCups: trip.droppedUsedCups,
      juiceJars: trip.juiceJars.map((load) => ({
        physicalJarId: load.physicalJarId,
        recipeId: load.recipeId,
        recipeName: load.recipeName,
        customerIds: [...load.customerIds],
        servings: load.servings,
        retainedLeftoverServings: load.retainedLeftoverServings,
        plannedFillServings: load.plannedFillServings,
        fillAction: load.fillAction,
      })),
    })),
    productionJarFills: salesPlan.productionJarFills.map((fill) => ({
      ...fill,
    })),
    discardedInitialJuice: salesPlan.discardedInitialJuice.map((item) => ({
      ...item,
    })),
    discardedNewProductionJuice:
      salesPlan.discardedNewProductionJuice.map((item) => ({
        ...item,
      })),
    finalCleanCups: salesPlan.finalCleanCups,
    finalUsedCups: salesPlan.finalUsedCups,
    finalPhysicalCupCount: salesPlan.finalPhysicalCupCount,
    recipes: shortfall.recipes.map((recipe) => ({
      recipeId: recipe.recipeId,
      juiceUnitsToPrepare: recipe.juiceUnitsToPrepare,
      ingredientUnitsPerJuiceUnit:
        recipe.ingredientUnitsPerJuiceUnit.map((item) => ({
          ...item,
        })),
    })),
  }
}

export function deliveryExecutionPlanFingerprint(
  shortfall: PreparationShortfall,
  salesPlan: MultiTripReplenishmentPlan,
): string {
  return JSON.stringify(normalizedPlanPayload(shortfall, salesPlan))
}

function firstFillTripByJar(
  fills: readonly MultiTripProductionJarFill[],
): Map<string, number> {
  const result = new Map<string, number>()
  for (const fill of [...fills].sort(
    (a, b) =>
      a.beforeTripNumber - b.beforeTripNumber ||
      a.physicalJarId.localeCompare(b.physicalJarId),
  )) {
    if (!result.has(fill.physicalJarId)) {
      result.set(fill.physicalJarId, fill.beforeTripNumber)
    }
  }
  return result
}

export function buildDeliveryExecutionPlan(
  shortfall: PreparationShortfall,
  salesPlan: MultiTripReplenishmentPlan,
): DeliveryExecutionPlan {
  const recipeById = new Map(
    shortfall.recipes.map((recipe) => [recipe.recipeId, recipe]),
  )
  const producedUnitsByRecipeId = new Map<string, number>()
  for (const fill of salesPlan.productionJarFills) {
    if (
      fill.servings < 1 ||
      fill.servings % 2 !== 0 ||
      fill.servingsAfterFill < fill.servings
    ) {
      throw new Error(
        `Production fill for ${fill.recipeId} is not a valid finalizer output`,
      )
    }
    producedUnitsByRecipeId.set(
      fill.recipeId,
      (producedUnitsByRecipeId.get(fill.recipeId) ?? 0) +
        fill.servings / 2,
    )
  }

  for (const recipe of shortfall.recipes) {
    const scheduled =
      producedUnitsByRecipeId.get(recipe.recipeId) ?? 0
    if (scheduled !== recipe.juiceUnitsToPrepare) {
      throw new Error(
        `Delivery execution production units drifted for ${recipe.recipeId}: expected ${recipe.juiceUnitsToPrepare}, got ${scheduled}`,
      )
    }
  }

  const firstFillByJar = firstFillTripByJar(
    salesPlan.productionJarFills,
  )
  for (const discarded of salesPlan.discardedInitialJuice) {
    if (!firstFillByJar.has(discarded.physicalJarId)) {
      throw new Error(
        `Initial-juice discard for ${discarded.physicalJarId} has no later production fill`,
      )
    }
  }

  const seenCustomers = new Set<string>()
  const trips = salesPlan.trips.map(
    (trip, index): DeliveryExecutionTrip => {
      if (trip.tripNumber !== index + 1) {
        throw new Error(
          'Delivery execution requires contiguous sales trip numbers',
        )
      }
      if (trip.cupsWashedBeforeTrip !== trip.cupWashWaterUnits) {
        throw new Error(
          `Trip ${trip.tripNumber} cup-wash water does not match cups washed`,
        )
      }

      const deliveries = trip.juiceJars.flatMap((load) => {
        if (load.customerIds.length !== load.servings) {
          throw new Error(
            `Trip ${trip.tripNumber} jar ${load.physicalJarId} customer count does not match servings`,
          )
        }

        return load.customerIds.map(
          (customerId): DeliveryExecutionCustomer => {
            if (seenCustomers.has(customerId)) {
              throw new Error(
                `Delivery execution schedules customer ${customerId} more than once`,
              )
            }
            seenCustomers.add(customerId)
            return {
              customerId,
              physicalJarId: load.physicalJarId,
              recipeId: load.recipeId,
              recipeName: load.recipeName,
            }
          },
        )
      })

      if (deliveries.length !== trip.totalServings) {
        throw new Error(
          `Trip ${trip.tripNumber} delivery count does not match total servings`,
        )
      }

      const productionFills = salesPlan.productionJarFills
        .filter((fill) => fill.beforeTripNumber === trip.tripNumber)
        .sort((a, b) =>
          a.physicalJarId.localeCompare(b.physicalJarId),
        )
      const ingredientUnits = new Map<string, number>()
      let productionWaterUnits = 0

      for (const fill of productionFills) {
        const recipe = recipeById.get(fill.recipeId)
        if (!recipe) {
          throw new Error(
            `Production fill references unknown shortfall recipe ${fill.recipeId}`,
          )
        }
        const juiceUnits = fill.servings / 2
        productionWaterUnits += juiceUnits
        for (const ingredient of recipe.ingredientUnitsPerJuiceUnit) {
          ingredientUnits.set(
            ingredient.ingredientId,
            (ingredientUnits.get(ingredient.ingredientId) ?? 0) +
              ingredient.quantityPerJuiceUnit * juiceUnits,
          )
        }
      }

      const initialJuiceDiscards =
        salesPlan.discardedInitialJuice.filter(
          (discarded) =>
            firstFillByJar.get(discarded.physicalJarId) ===
            trip.tripNumber,
        )
      const newProductionDiscards =
        salesPlan.discardedNewProductionJuice.filter(
          (discarded) =>
            discarded.afterTripNumber === trip.tripNumber,
        )

      const executionTrip: DeliveryExecutionTrip = {
        tripNumber: trip.tripNumber,
        productionFills,
        initialJuiceDiscards,
        ingredientRequirements: [...ingredientUnits.entries()]
          .map(([ingredientId, units]) => ({
            ingredientId,
            units,
          }))
          .sort((a, b) =>
            a.ingredientId.localeCompare(b.ingredientId),
          ),
        productionWaterUnits,
        cupsWashedBeforeTrip: trip.cupsWashedBeforeTrip,
        cupWashWaterUnits: trip.cupWashWaterUnits,
        cleanCupsBeforeTrip: trip.cleanCupsBeforeTrip,
        usedCupsBeforeTrip: trip.usedCupsBeforeTrip,
        cleanCupsAfterTrip: trip.cleanCupsAfterTrip,
        usedCupsAfterTrip: trip.usedCupsAfterTrip,
        juiceJarSlotsCarried: trip.juiceJarSlotsCarried,
        deliveries,
        newProductionDiscards,
      }

      const cupProgress = cupProgressAfterDeliveries(
        executionTrip,
        salesPlan.policy,
        deliveries.length,
      )
      if (cupProgress.droppedUsedCups !== trip.droppedUsedCups) {
        throw new Error(
          `Trip ${trip.tripNumber} per-delivery cup trace does not match planned dropped cups`,
        )
      }

      return executionTrip
    },
  )

  return {
    planFingerprint: deliveryExecutionPlanFingerprint(
      shortfall,
      salesPlan,
    ),
    policy: salesPlan.policy,
    trips,
    finalCleanCups: salesPlan.finalCleanCups,
    finalUsedCups: salesPlan.finalUsedCups,
    finalPhysicalCupCount: salesPlan.finalPhysicalCupCount,
  }
}

export function createDeliveryExecutionCursor(
  plan: DeliveryExecutionPlan,
): DeliveryExecutionCursor {
  return {
    planFingerprint: plan.planFingerprint,
    nextTripNumber: 1,
    tripPrepared: false,
    completedCustomerIdsInTrip: [],
  }
}

function jarById(
  inventory: InventoryState,
  physicalJarId: string,
) {
  const jar = inventory.juiceJars.find(
    (item) => item.id === physicalJarId,
  )
  if (!jar) {
    throw new Error(
      `Delivery execution references missing physical jar ${physicalJarId}`,
    )
  }
  return jar
}

function prepareTrip(
  inventory: InventoryState,
  trip: DeliveryExecutionTrip,
): {
  ingredientChanges: DeliveryExecutionIngredientChange[]
  waterChange: DeliveryExecutionWaterChange
} {
  if (
    inventory.cleanCups !== trip.cleanCupsBeforeTrip ||
    inventory.usedCups !== trip.usedCupsBeforeTrip
  ) {
    throw new Error(
      `Trip ${trip.tripNumber} cup inventory no longer matches its planned start state`,
    )
  }

  for (const discarded of trip.initialJuiceDiscards) {
    const jar = jarById(inventory, discarded.physicalJarId)
    if (
      jar.recipeId !== discarded.recipeId ||
      discarded.servings < 1 ||
      jar.servings < discarded.servings
    ) {
      throw new Error(
        `Initial-juice discard no longer matches ${discarded.physicalJarId}`,
      )
    }
    jar.servings -= discarded.servings
    if (jar.servings === 0) {
      jar.recipeId = null
    }
  }

  const ingredientChanges =
    trip.ingredientRequirements.map(
      (requirement): DeliveryExecutionIngredientChange => {
        const before =
          inventory.ingredientUnits[requirement.ingredientId] ?? 0
        const consumedFromInventory = Math.min(
          before,
          requirement.units,
        )
        const after = before - consumedFromInventory
        if (after > 0) {
          inventory.ingredientUnits[requirement.ingredientId] = after
        } else {
          delete inventory.ingredientUnits[requirement.ingredientId]
        }

        return {
          ingredientId: requirement.ingredientId,
          requiredUnits: requirement.units,
          consumedFromInventory,
          externalUnitsRequired:
            requirement.units - consumedFromInventory,
        }
      },
    )

  const totalWaterRequired =
    trip.productionWaterUnits + trip.cupWashWaterUnits
  const waterBefore = inventory.waterUnits
  const waterConsumedFromInventory = Math.min(
    waterBefore,
    totalWaterRequired,
  )
  inventory.waterUnits =
    waterBefore - waterConsumedFromInventory

  if (trip.cupsWashedBeforeTrip > inventory.usedCups) {
    throw new Error(
      `Trip ${trip.tripNumber} cannot wash more used cups than currently exist`,
    )
  }
  inventory.usedCups -= trip.cupsWashedBeforeTrip
  inventory.cleanCups += trip.cupsWashedBeforeTrip

  for (const fill of trip.productionFills) {
    const jar = jarById(inventory, fill.physicalJarId)

    if (fill.fillAction === 'initial-fill') {
      if (jar.recipeId !== null || jar.servings !== 0) {
        throw new Error(
          `Initial fill requires empty physical jar ${fill.physicalJarId}`,
        )
      }
    } else if (fill.fillAction === 'refill-same-type') {
      if (
        jar.servings > 0 &&
        jar.recipeId !== fill.recipeId
      ) {
        throw new Error(
          `Same-type refill no longer matches physical jar ${fill.physicalJarId}`,
        )
      }
      if (jar.servings === 0 && jar.recipeId !== null) {
        throw new Error(
          `Empty physical jar ${fill.physicalJarId} has inconsistent current contents`,
        )
      }
    } else if (fill.fillAction === 'type-switch') {
      if (jar.servings !== 0) {
        throw new Error(
          `Type switch requires empty physical jar ${fill.physicalJarId}`,
        )
      }
    }

    jar.recipeId = fill.recipeId
    jar.servings += fill.servings
    if (jar.servings !== fill.servingsAfterFill) {
      throw new Error(
        `Production fill total drifted for physical jar ${fill.physicalJarId}`,
      )
    }
  }

  return {
    ingredientChanges,
    waterChange: {
      requiredUnits: totalWaterRequired,
      productionUnitsRequired: trip.productionWaterUnits,
      cupWashUnitsRequired: trip.cupWashWaterUnits,
      consumedFromInventory: waterConsumedFromInventory,
      externalUnitsRequired:
        totalWaterRequired - waterConsumedFromInventory,
    },
  }
}

function applyTripEndDiscards(
  inventory: InventoryState,
  trip: DeliveryExecutionTrip,
) {
  for (const discarded of trip.newProductionDiscards) {
    const jar = jarById(inventory, discarded.physicalJarId)
    if (
      jar.recipeId !== discarded.recipeId ||
      jar.servings < discarded.servings
    ) {
      throw new Error(
        `Trip-end discard no longer matches physical jar ${discarded.physicalJarId}`,
      )
    }
    jar.servings -= discarded.servings
    if (jar.servings === 0) {
      jar.recipeId = null
    }
  }
}

export function applyDeliveryExecutionCustomer(
  plan: DeliveryExecutionPlan,
  sourceInventory: InventoryState,
  cursor: DeliveryExecutionCursor,
  customerId: string,
): DeliveryExecutionStepResult {
  if (cursor.planFingerprint !== plan.planFingerprint) {
    throw new Error(
      'Delivery execution cursor belongs to a different plan',
    )
  }

  const trip = plan.trips[cursor.nextTripNumber - 1]
  if (!trip) {
    throw new Error('Delivery execution plan is already complete')
  }

  const completed = new Set(
    cursor.completedCustomerIdsInTrip,
  )
  if (completed.has(customerId)) {
    throw new Error(
      `Customer ${customerId} was already delivered in trip ${trip.tripNumber}`,
    )
  }

  const delivery = trip.deliveries.find(
    (item) => item.customerId === customerId,
  )
  if (!delivery) {
    const laterTrip = plan.trips
      .slice(cursor.nextTripNumber)
      .find((item) =>
        item.deliveries.some(
          (candidate) => candidate.customerId === customerId,
        ),
      )
    if (laterTrip) {
      throw new Error(
        `Customer ${customerId} belongs to later trip ${laterTrip.tripNumber}; complete trip ${trip.tripNumber} first`,
      )
    }
    throw new Error(
      `Customer ${customerId} is not pending in the active delivery plan`,
    )
  }

  const inventory = cloneInventory(sourceInventory)
  let ingredientChanges: DeliveryExecutionIngredientChange[] = []
  let waterChange: DeliveryExecutionWaterChange = {
    requiredUnits: 0,
    productionUnitsRequired: 0,
    cupWashUnitsRequired: 0,
    consumedFromInventory: 0,
    externalUnitsRequired: 0,
  }

  if (!cursor.tripPrepared) {
    const prepared = prepareTrip(inventory, trip)
    ingredientChanges = prepared.ingredientChanges
    waterChange = prepared.waterChange
  }

  const jar = jarById(inventory, delivery.physicalJarId)
  if (
    jar.recipeId !== delivery.recipeId ||
    jar.servings < 1
  ) {
    throw new Error(
      `Physical jar ${delivery.physicalJarId} cannot deliver ${delivery.recipeId} to ${customerId}`,
    )
  }

  const servedBefore = completed.size
  const beforeCupProgress = cupProgressAfterDeliveries(
    trip,
    plan.policy,
    servedBefore,
  )
  const afterCupProgress = cupProgressAfterDeliveries(
    trip,
    plan.policy,
    servedBefore + 1,
  )
  const droppedThisDelivery =
    afterCupProgress.droppedUsedCups -
    beforeCupProgress.droppedUsedCups

  const cleanBefore = inventory.cleanCups
  const usedBefore = inventory.usedCups
  if (cleanBefore < 1) {
    throw new Error(
      `Customer ${customerId} cannot be served without a clean cup`,
    )
  }

  inventory.cleanCups -= 1
  if (droppedThisDelivery === 0) {
    inventory.usedCups += 1
  } else if (droppedThisDelivery !== 1) {
    throw new Error(
      `Customer ${customerId} produced an invalid used-cup transition`,
    )
  }

  jar.servings -= 1
  if (jar.servings === 0) {
    jar.recipeId = null
  }

  completed.add(customerId)
  const tripCompleted = completed.size === trip.deliveries.length
  const newProductionDiscards = tripCompleted
    ? [...trip.newProductionDiscards]
    : []

  let nextCursor: DeliveryExecutionCursor
  if (tripCompleted) {
    applyTripEndDiscards(inventory, trip)

    if (
      inventory.cleanCups !== trip.cleanCupsAfterTrip ||
      inventory.usedCups !== trip.usedCupsAfterTrip
    ) {
      throw new Error(
        `Trip ${trip.tripNumber} cup end state drifted from the sales plan`,
      )
    }

    nextCursor = {
      planFingerprint: plan.planFingerprint,
      nextTripNumber: trip.tripNumber + 1,
      tripPrepared: false,
      completedCustomerIdsInTrip: [],
    }
  } else {
    nextCursor = {
      planFingerprint: plan.planFingerprint,
      nextTripNumber: trip.tripNumber,
      tripPrepared: true,
      completedCustomerIdsInTrip: [...completed],
    }
  }

  if (
    nextCursor.nextTripNumber > plan.trips.length &&
    (
      inventory.cleanCups !== plan.finalCleanCups ||
      inventory.usedCups !== plan.finalUsedCups ||
      inventory.cleanCups + inventory.usedCups !==
        plan.finalPhysicalCupCount
    )
  ) {
    throw new Error(
      'Delivery execution final cup state drifted from the sales plan',
    )
  }

  return {
    inventory,
    cursor: nextCursor,
    changes: {
      tripPreparedNow: !cursor.tripPrepared,
      ingredients: ingredientChanges,
      water: waterChange,
      initialJuiceDiscards: cursor.tripPrepared
        ? []
        : [...trip.initialJuiceDiscards],
      productionFills: cursor.tripPrepared
        ? []
        : [...trip.productionFills],
      deliveredCustomerId: customerId,
      deliveredPhysicalJarId: delivery.physicalJarId,
      deliveredRecipeId: delivery.recipeId,
      cup: {
        cleanBefore,
        cleanAfter: inventory.cleanCups,
        usedBefore,
        usedAfter: inventory.usedCups,
        droppedUsedCups: droppedThisDelivery,
      },
      newProductionDiscards,
      tripCompleted,
    },
  }
}
