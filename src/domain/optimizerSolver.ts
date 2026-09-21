import type {
  BatchOptimizationModel,
  OptimizationCriterion,
} from './optimizerModel'

export interface BatchSolverAssignment {
  customerId: string
  recipeId: string
}

export interface BatchSolverSolution {
  assignments: BatchSolverAssignment[]
  /** Number of juice units to make. One juice unit becomes two sellable servings. */
  productionUnitsByRecipeId: Record<string, number>
  metrics: {
    totalIngredientCost: number
    totalProductionUnits: number
    recipeKinds: number
    machineOperations: number
    jarTypeSwitches: number
  }
}

export interface BatchOptimizerSolver {
  solve(
    model: BatchOptimizationModel,
    priorities: OptimizationCriterion[],
  ): Promise<BatchSolverSolution>
}
