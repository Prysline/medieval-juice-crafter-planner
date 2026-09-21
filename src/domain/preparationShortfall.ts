import { ingredients } from '../data/ingredients'
import type { InventoryState } from '../types'
import type {
  PreparationDemand,
  PreparationRecipeIngredient,
} from './preparationDemand'

export interface RecipeStockAdjustment {
  recipeId: string
  recipeName: string
  ingredientIds: string[]
  assignedServings: number
  finishedServingsAvailable: number
  finishedServingsUsed: number
  finishedServingsRemaining: number
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

function finishedServingsByRecipe(
  inventory: InventoryState,
): Map<string, number> {
  const result = new Map<string, number>()

  for (const jar of inventory.juiceJars) {
    if (!jar.recipeId || jar.servings <= 0) continue
    result.set(
      jar.recipeId,
      (result.get(jar.recipeId) ?? 0) + jar.servings,
    )
  }

  return result
}

export function buildPreparationShortfall(
  demand: PreparationDemand,
  inventory: InventoryState,
): PreparationShortfall {
  const finishedStock = finishedServingsByRecipe(inventory)

  const recipes = demand.recipes.map((recipe): RecipeStockAdjustment => {
    const finishedServingsAvailable =
      finishedStock.get(recipe.recipeId) ?? 0
    const finishedServingsUsed = Math.min(
      recipe.assignedServings,
      finishedServingsAvailable,
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
      servingsToProduce,
      juiceUnitsToPrepare,
      newlyProducedServings,
      newProductionLeftoverServings:
        newlyProducedServings - servingsToProduce,
      ingredientUnitsPerJuiceUnit:
        recipe.ingredientUnitsPerJuiceUnit,
    }
  })

  const requiredByIngredient = new Map<string, number>()
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredientUnitsPerJuiceUnit) {
      requiredByIngredient.set(
        ingredient.ingredientId,
        (requiredByIngredient.get(ingredient.ingredientId) ?? 0) +
          ingredient.quantityPerJuiceUnit * recipe.juiceUnitsToPrepare,
      )
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

  const productionWaterUnitsRequired = recipes.reduce(
    (sum, recipe) => sum + recipe.juiceUnitsToPrepare,
    0,
  )
  const waterUnitsUsed = Math.min(
    productionWaterUnitsRequired,
    inventory.waterUnits,
  )

  return {
    recipes,
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
