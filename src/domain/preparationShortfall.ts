import { ingredients } from '../data/ingredients'
import type { InventoryState } from '../types'
import type {
  PreparationDemand,
  PreparationRecipeIngredient,
} from './preparationDemand'
import {
  buildStockOffsetProductionPlan,
  type IntermediateJuiceStockUsage,
  type ProductionPlan,
  type StockOffsetRecipeUsage,
} from './productionPlan'

export interface FinishedJarStockUsage {
  physicalJarId: string
  recipeId: string
  initialServings: number
  servingsUsed: number
  servingsRemaining: number
}

export interface PreparationShortfallOptions {
  /**
   * When provided, only these persistent jars may satisfy finished-stock
   * demand directly. The order still follows InventoryState.juiceJars.
   */
  finishedJuiceJarIds?: string[]
}

export interface RecipeStockAdjustment {
  recipeId: string
  recipeName: string
  ingredientIds: string[]
  assignedServings: number
  finishedServingsAvailable: number
  finishedServingsUsed: number
  finishedServingsRemaining: number
  finishedStockSources: FinishedJarStockUsage[]
  servingsToProduce: number
  juiceUnitsToPrepare: number
  newlyProducedServings: number
  newProductionLeftoverServings: number
  ingredientUnitsPerJuiceUnit: PreparationRecipeIngredient[]
}

export interface IngredientShortfall {
  ingredientId: string
  name: string
  requiredUnits: number
  inventoryUnitsAvailable: number
  inventoryUnitsUsed: number
  purchaseUnits: number
}

export interface PreparationShortfall {
  recipes: RecipeStockAdjustment[]
  /** Canonical stock-offset graph used by production logistics. */
  netProductionPlan?: ProductionPlan
  /** Planned intermediate-stock consumption authority. */
  intermediateStockUsage?: IntermediateJuiceStockUsage[]
  /** Per-final-recipe provenance for partial execution; sums to the plan authority. */
  stockOffsetRecipeUsage?: StockOffsetRecipeUsage[]
  ingredients: IngredientShortfall[]
  productionWaterUnitsRequired: number
  waterUnitsAvailable: number
  waterUnitsUsed: number
  waterUnitsToFetch: number
  cleanCupUses: number
  cleanCupsAvailable: number
  cleanCupShortfallBeforeWashing: number
  usedCupsAvailable: number
}

const ingredientById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient]),
)

function finishedJarsByRecipe(
  inventory: InventoryState,
  options: PreparationShortfallOptions,
): Map<string, InventoryState['juiceJars']> {
  const result = new Map<string, InventoryState['juiceJars']>()
  const eligibleIds = options.finishedJuiceJarIds
    ? new Set(options.finishedJuiceJarIds)
    : null

  for (const jar of inventory.juiceJars) {
    if (
      !jar.recipeId ||
      jar.servings <= 0 ||
      (eligibleIds && !eligibleIds.has(jar.id))
    ) {
      continue
    }

    const current = result.get(jar.recipeId) ?? []
    current.push(jar)
    result.set(jar.recipeId, current)
  }

  return result
}

function allocateFinishedJarStock(
  recipeId: string,
  assignedServings: number,
  jars: InventoryState['juiceJars'],
): FinishedJarStockUsage[] {
  let remainingDemand = Math.max(0, Math.floor(assignedServings))

  // Consume smaller same-recipe jars first so existing stock is still used
  // before new production while maximizing the number of physical jars that
  // become completely empty and reusable later in the day.
  return [...jars]
    .sort(
      (a, b) =>
        Math.max(0, Math.floor(a.servings)) -
          Math.max(0, Math.floor(b.servings)) ||
        a.id.localeCompare(b.id),
    )
    .map((jar) => {
      const initialServings = Math.max(0, Math.floor(jar.servings))
      const servingsUsed = Math.min(initialServings, remainingDemand)
      remainingDemand -= servingsUsed

      return {
        physicalJarId: jar.id,
        recipeId,
        initialServings,
        servingsUsed,
        servingsRemaining: initialServings - servingsUsed,
      }
    })
}

export function buildPreparationShortfall(
  demand: PreparationDemand,
  inventory: InventoryState,
  options: PreparationShortfallOptions = {},
): PreparationShortfall {
  const finishedStock = finishedJarsByRecipe(inventory, options)

  const recipes = demand.recipes.map((recipe): RecipeStockAdjustment => {
    const finishedStockSources = allocateFinishedJarStock(
      recipe.recipeId,
      recipe.assignedServings,
      finishedStock.get(recipe.recipeId) ?? [],
    )
    const finishedServingsAvailable = finishedStockSources.reduce(
      (sum, source) => sum + source.initialServings,
      0,
    )
    const finishedServingsUsed = finishedStockSources.reduce(
      (sum, source) => sum + source.servingsUsed,
      0,
    )
    const servingsToProduce =
      recipe.assignedServings - finishedServingsUsed
    const juiceUnitsToPrepare = Math.ceil(servingsToProduce / 2)
    const newlyProducedServings = juiceUnitsToPrepare * 2

    return {
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
      ingredientIds: [...recipe.ingredientIds],
      assignedServings: recipe.assignedServings,
      finishedServingsAvailable,
      finishedServingsUsed,
      finishedServingsRemaining:
        finishedServingsAvailable - finishedServingsUsed,
      finishedStockSources,
      servingsToProduce,
      juiceUnitsToPrepare,
      newlyProducedServings,
      newProductionLeftoverServings:
        newlyProducedServings - servingsToProduce,
      ingredientUnitsPerJuiceUnit:
        recipe.ingredientUnitsPerJuiceUnit,
    }
  })

  const hasIntermediateStock = Object.values(
    inventory.intermediateJuiceUnits ?? {},
  ).some((quantity) => Math.floor(quantity) > 0)

  const stockOffsetPlan = hasIntermediateStock
    ? buildStockOffsetProductionPlan(
        recipes
          .filter((recipe) => recipe.juiceUnitsToPrepare > 0)
          .map((recipe) => ({
            recipeId: recipe.recipeId,
            recipeName: recipe.recipeName,
            ingredientIds: [...recipe.ingredientIds],
            juiceUnits: recipe.juiceUnitsToPrepare,
            assignedServings: recipe.servingsToProduce,
          })),
        inventory.intermediateJuiceUnits ?? {},
      )
    : null

  const requiredByIngredient = new Map<string, number>()
  if (stockOffsetPlan) {
    for (const step of stockOffsetPlan.steps) {
      if (
        (step.kind !== 'juicing' && step.kind !== 'seasoning') ||
        !step.addedIngredientId
      ) {
        continue
      }

      requiredByIngredient.set(
        step.addedIngredientId,
        (requiredByIngredient.get(step.addedIngredientId) ?? 0) +
          step.quantity,
      )
    }
  } else {
    for (const recipe of recipes) {
      for (const ingredient of recipe.ingredientUnitsPerJuiceUnit) {
        requiredByIngredient.set(
          ingredient.ingredientId,
          (requiredByIngredient.get(ingredient.ingredientId) ?? 0) +
            ingredient.quantityPerJuiceUnit * recipe.juiceUnitsToPrepare,
        )
      }
    }
  }

  const ingredientShortfalls = [...requiredByIngredient.entries()]
    .filter(([, requiredUnits]) => requiredUnits > 0)
    .map(([ingredientId, requiredUnits]): IngredientShortfall => {
      const ingredient = ingredientById.get(ingredientId)
      const inventoryUnitsAvailable =
        inventory.ingredientUnits[ingredientId] ?? 0
      const inventoryUnitsUsed = Math.min(
        requiredUnits,
        inventoryUnitsAvailable,
      )

      return {
        ingredientId,
        name: ingredient?.name ?? ingredientId,
        requiredUnits,
        inventoryUnitsAvailable,
        inventoryUnitsUsed,
        purchaseUnits: requiredUnits - inventoryUnitsUsed,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))

  const productionWaterUnitsRequired = stockOffsetPlan
    ? stockOffsetPlan.steps
        .filter((step) => step.kind === 'finalizing')
        .reduce((sum, step) => sum + step.quantity, 0)
    : recipes.reduce(
        (sum, recipe) => sum + recipe.juiceUnitsToPrepare,
        0,
      )
  const waterUnitsUsed = Math.min(
    productionWaterUnitsRequired,
    inventory.waterUnits,
  )

  return {
    recipes,
    ...(stockOffsetPlan
      ? {
          netProductionPlan: {
            steps: stockOffsetPlan.steps,
            machineOperations: stockOffsetPlan.machineOperations,
            readyForFinalizingUnitsByStepKey:
              stockOffsetPlan.readyForFinalizingUnitsByStepKey,
            seasoningIngredientUnits:
              stockOffsetPlan.seasoningIngredientUnits,
            seasoningBaseJuiceUnits:
              stockOffsetPlan.seasoningBaseJuiceUnits,
            seasoningStageReuseUnitsByStepKey:
              stockOffsetPlan.seasoningStageReuseUnitsByStepKey,
          },
          intermediateStockUsage:
            stockOffsetPlan.intermediateStockUsage,
          stockOffsetRecipeUsage: stockOffsetPlan.recipeUsage,
        }
      : {}),
    ingredients: ingredientShortfalls,
    productionWaterUnitsRequired,
    waterUnitsAvailable: inventory.waterUnits,
    waterUnitsUsed,
    waterUnitsToFetch:
      productionWaterUnitsRequired - waterUnitsUsed,
    cleanCupUses: demand.assignedServings,
    cleanCupsAvailable: inventory.cleanCups,
    cleanCupShortfallBeforeWashing: Math.max(
      0,
      demand.assignedServings - inventory.cleanCups,
    ),
    usedCupsAvailable: inventory.usedCups,
  }
}
