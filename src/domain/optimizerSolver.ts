import type {
  BatchOptimizationModel,
  OptimizationObjective,
} from './optimizerModel'

export interface BatchSolverAssignment {
  customerId: string
  recipeId: string
}

export interface BatchSolverSolution {
  assignments: BatchSolverAssignment[]
  batchCountByRecipeId: Record<string, number>
  metrics: {
    totalIngredientCost: number
    totalBatches: number
    recipeKinds: number
  }
}

export interface BatchOptimizerSolver {
  solve(
    model: BatchOptimizationModel,
    objective: OptimizationObjective,
  ): Promise<BatchSolverSolution>
}
