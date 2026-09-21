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
  /** Ordered ingredient ids used by one batch; preserves future sequence identity. */
  ingredientIds: string[]
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
  knownSalesRevenue: number
  knownGrossProfit: number
  formalSalesCount: number
  potentialTrialCount: number
  unknownFormalSalePriceCount: number
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
    const ingredientIds = recipe.candidate.ingredients.map((ingredientName) => {
      const ingredient = ingredientByName.get(ingredientName)
      if (!ingredient) {
        throw new Error(`Missing ingredient id for batch plan: ${ingredientName}`)
      }
      return ingredient.id
    })

    return Array.from({ length: batchCount }, (_, batchIndex) => ({
      recipeId: recipe.candidate.id,
      recipeName: recipe.candidate.name,
      batchNumber: batchIndex + 1,
      customerIds: customerIds.slice(batchIndex * 2, batchIndex * 2 + 2),
      ingredientIds,
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
  const formalCustomerIds = new Set(request.formalCustomerIds)
  const candidateById = new Map(
    model.recipes.map((recipe) => [
      recipe.candidate.id,
      recipe.candidate,
    ]),
  )
  let knownSalesRevenue = 0
  let formalSalesCount = 0
  let potentialTrialCount = 0
  let unknownFormalSalePriceCount = 0

  for (const assignment of solution.assignments) {
    if (!formalCustomerIds.has(assignment.customerId)) {
      potentialTrialCount += 1
      continue
    }

    formalSalesCount += 1
    const candidate = candidateById.get(assignment.recipeId)
    if (!candidate || candidate.salePrice === null) {
      unknownFormalSalePriceCount += 1
      continue
    }

    knownSalesRevenue += candidate.salePrice
  }
  const knownGrossProfit =
    knownSalesRevenue - solution.metrics.totalIngredientCost

  return {
    assignments: solution.assignments,
    batches,
    shoppingList,
    unresolvedCustomers: model.unresolvedCustomerIds,
    totalIngredientCost: solution.metrics.totalIngredientCost,
    knownSalesRevenue,
    knownGrossProfit,
    formalSalesCount,
    potentialTrialCount,
    unknownFormalSalePriceCount,
    producedServings,
    assignedServings,
    leftoverServings: producedServings - assignedServings,
  }
}
