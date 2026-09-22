import { customers as canonicalCustomers } from '../data/customers'
import { ingredients } from '../data/ingredients'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import { highsSolverAdapter } from './optimizerHighsSolver'
import type { BatchOptimizerSolver } from './optimizerSolver'
import {
  buildOptimizationModel,
  normalizedAvailableJuiceJarCount,
  normalizedOptimizationPriorities,
  type OptimizationRequest,
  type OptimizationSource,
} from './optimizerModel'
import {
  buildProductionPlan,
  type MachineOperationSummary,
  type ProductionStep,
} from './productionPlan'

export type {
  OptimizationCandidatePolicy,
  OptimizationCriterion,
  OptimizationConstraints,
  OptimizationObjective,
  OptimizationRequest,
} from './optimizerModel'

export interface CustomerAssignment {
  customerId: string
  recipeId: string
}

export interface RecipeProductionPlan {
  recipeId: string
  recipeName: string
  customerIds: string[]
  /** One juice unit becomes two sellable servings at the finalizer. */
  juiceUnits: number
  producedServings: number
  assignedServings: number
  leftoverServings: number
  ingredientIds: string[]
  juiceUnitIngredientCost: number
  totalIngredientCost: number
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
  recipePlans: RecipeProductionPlan[]
  productionSteps: ProductionStep[]
  machineOperations: MachineOperationSummary
  jarTypeSwitches: number
  availableJuiceJarCount: number
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

function normalizeRecipePlans(
  model: ReturnType<typeof buildOptimizationModel>,
  assignments: CustomerAssignment[],
  productionUnitsByRecipeId: Record<string, number>,
): RecipeProductionPlan[] {
  const assignedByRecipe = new Map<string, string[]>()

  for (const assignment of assignments) {
    const current = assignedByRecipe.get(assignment.recipeId) ?? []
    current.push(assignment.customerId)
    assignedByRecipe.set(assignment.recipeId, current)
  }

  return model.recipes.flatMap((recipe) => {
    const juiceUnits =
      productionUnitsByRecipeId[recipe.candidate.id] ?? 0
    if (juiceUnits <= 0) return []

    const customerIds = assignedByRecipe.get(recipe.candidate.id) ?? []
    const producedServings = juiceUnits * 2

    return [{
      recipeId: recipe.candidate.id,
      recipeName: recipe.candidate.name,
      customerIds,
      juiceUnits,
      producedServings,
      assignedServings: customerIds.length,
      leftoverServings: producedServings - customerIds.length,
      ingredientIds: recipe.productionPath.ingredientIds,
      juiceUnitIngredientCost: recipe.juiceUnitIngredientCost,
      totalIngredientCost:
        recipe.juiceUnitIngredientCost * juiceUnits,
    }]
  })
}

function buildShoppingList(
  model: ReturnType<typeof buildOptimizationModel>,
  productionUnitsByRecipeId: Record<string, number>,
): IngredientPurchase[] {
  const quantityByIngredientId = new Map<string, number>()

  for (const recipe of model.recipes) {
    const juiceUnits =
      productionUnitsByRecipeId[recipe.candidate.id] ?? 0
    if (juiceUnits <= 0) continue

    for (const ingredientName of recipe.candidate.ingredients) {
      const ingredient = ingredientByName.get(ingredientName)
      if (!ingredient) continue
      quantityByIngredientId.set(
        ingredient.id,
        (quantityByIngredientId.get(ingredient.id) ?? 0) + juiceUnits,
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
    candidatePool: buildRecipeCandidatePool(request.currentProgress),
  }
  const model = buildOptimizationModel(request, source)
  const solver = options.solver ?? highsSolverAdapter
  const priorities = normalizedOptimizationPriorities(request)
  const solution = await solver.solve(model, priorities)
  const recipePlans = normalizeRecipePlans(
    model,
    solution.assignments,
    solution.productionUnitsByRecipeId,
  )
  const shoppingList = buildShoppingList(
    model,
    solution.productionUnitsByRecipeId,
  )
  const productionPlan = buildProductionPlan(
    recipePlans.map((plan) => ({
      recipeId: plan.recipeId,
      recipeName: plan.recipeName,
      ingredientIds: plan.ingredientIds,
      juiceUnits: plan.juiceUnits,
      assignedServings: plan.assignedServings,
    })),
  )
  const assignedServings = solution.assignments.length
  const producedServings = recipePlans.reduce(
    (total, plan) => total + plan.producedServings,
    0,
  )
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

  if (
    productionPlan.machineOperations.total !==
    solution.metrics.machineOperations
  ) {
    throw new Error('Production graph and solver operation count diverged')
  }

  return {
    assignments: solution.assignments,
    recipePlans,
    productionSteps: productionPlan.steps,
    machineOperations: productionPlan.machineOperations,
    jarTypeSwitches: solution.metrics.jarTypeSwitches,
    availableJuiceJarCount: normalizedAvailableJuiceJarCount(request),
    shoppingList,
    unresolvedCustomers: model.unresolvedCustomerIds,
    totalIngredientCost: solution.metrics.totalIngredientCost,
    knownSalesRevenue,
    knownGrossProfit:
      knownSalesRevenue - solution.metrics.totalIngredientCost,
    formalSalesCount,
    potentialTrialCount,
    unknownFormalSalePriceCount,
    producedServings,
    assignedServings,
    leftoverServings: producedServings - assignedServings,
  }
}
