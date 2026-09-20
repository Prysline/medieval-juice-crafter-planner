import { customers as canonicalCustomers } from '../data/customers'
import { ingredients } from '../data/ingredients'
import { generateRecipeCandidates } from './recipeGenerator'
import { highsSolverAdapter } from './optimizerHighsSolver'
import type { BatchOptimizerSolver } from './optimizerSolver'
import {
  buildOptimizationModel,
  type OptimizationRequest,
  type OptimizationSource,
} from './optimizerModel'

export type {
  OptimizationCandidatePolicy,
  OptimizationObjective,
  OptimizationRequest,
} from './optimizerModel'

export interface CustomerAssignment {
  customerId: string
  recipeId: string
}

export interface RecipeBatchPlan {
  recipeId: string
  recipeName: string
  batchNumber: number
  customerIds: string[]
  batchIngredientCost: number
}

export interface IngredientPurchase {
  ingredientId: string
  name: string
  quantity: number
  unitPrice: number
  totalCost: number
}

export interface OptimizationResult {
  assignments: CustomerAssignment[]
  batches: RecipeBatchPlan[]
  shoppingList: IngredientPurchase[]
  unresolvedCustomers: string[]
  totalIngredientCost: number
  producedServings: number
  assignedServings: number
  leftoverServings: number
}

const ingredientByName = new Map(
  ingredients.map((ingredient) => [ingredient.name, ingredient]),
)

function normalizeBatchPlans(
  model: ReturnType<typeof buildOptimizationModel>,
  assignments: CustomerAssignment[],
  batchCountByRecipeId: Record<string, number>,
): RecipeBatchPlan[] {
  const assignedByRecipe = new Map<string, string[]>()

  for (const assignment of assignments) {
    const current = assignedByRecipe.get(assignment.recipeId) ?? []
    current.push(assignment.customerId)
    assignedByRecipe.set(assignment.recipeId, current)
  }

  return model.recipes.flatMap((recipe) => {
    const batchCount = batchCountByRecipeId[recipe.candidate.id] ?? 0
    if (batchCount <= 0) return []

    const customerIds = assignedByRecipe.get(recipe.candidate.id) ?? []
    return Array.from({ length: batchCount }, (_, batchIndex) => ({
      recipeId: recipe.candidate.id,
      recipeName: recipe.candidate.name,
      batchNumber: batchIndex + 1,
      customerIds: customerIds.slice(batchIndex * 2, batchIndex * 2 + 2),
      batchIngredientCost: recipe.batchIngredientCost,
    }))
  })
}

function buildShoppingList(
  model: ReturnType<typeof buildOptimizationModel>,
  batchCountByRecipeId: Record<string, number>,
): IngredientPurchase[] {
  const quantityByIngredientId = new Map<string, number>()

  for (const recipe of model.recipes) {
    const batchCount = batchCountByRecipeId[recipe.candidate.id] ?? 0
    if (batchCount <= 0) continue

    for (const ingredientName of recipe.candidate.ingredients) {
      const ingredient = ingredientByName.get(ingredientName)
      if (!ingredient) continue
      quantityByIngredientId.set(
        ingredient.id,
        (quantityByIngredientId.get(ingredient.id) ?? 0) + batchCount,
      )
    }
  }

  return [...quantityByIngredientId.entries()]
    .map(([ingredientId, quantity]) => {
      const ingredient = ingredients.find((item) => item.id === ingredientId)
      if (!ingredient) {
        throw new Error(`Missing shopping-list ingredient: ${ingredientId}`)
      }

      return {
        ingredientId,
        name: ingredient.name,
        quantity,
        unitPrice: ingredient.buyPrice,
        totalCost: ingredient.buyPrice * quantity,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
}

export async function optimizeBatchPlan(
  request: OptimizationRequest,
  options: {
    source?: OptimizationSource
    solver?: BatchOptimizerSolver
  } = {},
): Promise<OptimizationResult> {
  const source = options.source ?? {
    customers: canonicalCustomers,
    candidates: generateRecipeCandidates(request.currentProgress),
  }
  const model = buildOptimizationModel(request, source)
  const solver = options.solver ?? highsSolverAdapter
  const solution = await solver.solve(model, request.objective)
  const batches = normalizeBatchPlans(
    model,
    solution.assignments,
    solution.batchCountByRecipeId,
  )
  const shoppingList = buildShoppingList(
    model,
    solution.batchCountByRecipeId,
  )
  const assignedServings = solution.assignments.length
  const producedServings = solution.metrics.totalBatches * 2

  return {
    assignments: solution.assignments,
    batches,
    shoppingList,
    unresolvedCustomers: model.unresolvedCustomerIds,
    totalIngredientCost: solution.metrics.totalIngredientCost,
    producedServings,
    assignedServings,
    leftoverServings: producedServings - assignedServings,
  }
}
