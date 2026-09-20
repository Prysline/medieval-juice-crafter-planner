import solver from 'javascript-lp-solver'
import type {
  BatchOptimizerSolver,
  BatchSolverSolution,
} from './optimizerSolver'
import type {
  BatchOptimizationModel,
  OptimizationObjective,
} from './optimizerModel'

type JsonModel = Parameters<typeof solver.Solve>[0]
type SolverResult = ReturnType<typeof solver.Solve> &
  Record<string, number | boolean | undefined>

type ObjectiveKey = 'cost' | 'batches' | 'kinds'

function cloneModel(model: JsonModel): JsonModel {
  return JSON.parse(JSON.stringify(model)) as JsonModel
}

function numericResult(result: SolverResult): number {
  const value = Number(result.result)
  if (!Number.isFinite(value)) {
    throw new Error('Solver returned a non-numeric objective value')
  }
  return Math.round(value)
}

function buildJsonModel(model: BatchOptimizationModel): {
  json: JsonModel
  xNameByRecipeId: Map<string, string>
  zNameByRecipeId: Map<string, string>
  yNameByCustomerRecipe: Map<string, string>
} {
  const constraints: Record<string, { min?: number; max?: number; equal?: number }> = {}
  const variables: Record<string, Record<string, number>> = {}
  const ints: Record<string, number> = {}
  const binaries: Record<string, number> = {}
  const xNameByRecipeId = new Map<string, string>()
  const zNameByRecipeId = new Map<string, string>()
  const yNameByCustomerRecipe = new Map<string, string>()
  const maxBatches = Math.max(
    1,
    Math.ceil(model.serviceableCustomerIds.length / 2),
  )

  model.serviceableCustomerIds.forEach((_, customerIndex) => {
    constraints[`customer_${customerIndex}`] = { equal: 1 }
  })

  model.recipes.forEach((recipe, recipeIndex) => {
    const xName = `x_${recipeIndex}`
    const zName = `z_${recipeIndex}`
    const capacityConstraint = `capacity_${recipeIndex}`
    const usageConstraint = `usage_${recipeIndex}`

    xNameByRecipeId.set(recipe.candidate.id, xName)
    zNameByRecipeId.set(recipe.candidate.id, zName)
    constraints[capacityConstraint] = { max: 0 }
    constraints[usageConstraint] = { max: 0 }

    variables[xName] = {
      cost: recipe.batchIngredientCost,
      batches: 1,
      [capacityConstraint]: -2,
      [usageConstraint]: 1,
    }
    ints[xName] = 1

    variables[zName] = {
      kinds: 1,
      [usageConstraint]: -maxBatches,
    }
    binaries[zName] = 1

    recipe.eligibleCustomerIds.forEach((customerId) => {
      const customerIndex = model.serviceableCustomerIds.indexOf(customerId)
      if (customerIndex < 0) return

      const yName = `y_${customerIndex}_${recipeIndex}`
      yNameByCustomerRecipe.set(
        `${customerId}\u001f${recipe.candidate.id}`,
        yName,
      )
      variables[yName] = {
        [`customer_${customerIndex}`]: 1,
        [capacityConstraint]: 1,
      }
      binaries[yName] = 1
    })
  })

  const json = {
    optimize: 'cost',
    opType: 'min',
    constraints,
    variables,
    ints,
    binaries,
  } as JsonModel

  return {
    json,
    xNameByRecipeId,
    zNameByRecipeId,
    yNameByCustomerRecipe,
  }
}

function addObjectiveFix(
  model: JsonModel,
  objective: ObjectiveKey,
  optimum: number,
  stageIndex: number,
): void {
  const constraintName = `fix_${objective}_${stageIndex}`
  const typed = model as unknown as {
    constraints: Record<string, { equal: number }>
    variables: Record<string, Record<string, number>>
  }

  typed.constraints[constraintName] = { equal: optimum }
  for (const coefficients of Object.values(typed.variables)) {
    coefficients[constraintName] = coefficients[objective] ?? 0
  }
}

function solveLexicographically(
  baseModel: JsonModel,
  objectives: ObjectiveKey[],
): SolverResult {
  const working = cloneModel(baseModel)
  let finalResult: SolverResult | null = null

  objectives.forEach((objective, index) => {
    ;(working as unknown as { optimize: ObjectiveKey }).optimize = objective
    const result = solver.Solve(working) as SolverResult

    if (!result.feasible) {
      throw new Error(`Optimizer solver is infeasible at ${objective}`)
    }

    finalResult = result
    if (index < objectives.length - 1) {
      addObjectiveFix(
        working,
        objective,
        numericResult(result),
        index,
      )
    }
  })

  if (!finalResult) {
    throw new Error('Optimizer solver did not run')
  }
  return finalResult
}

export const javascriptLpSolverAdapter: BatchOptimizerSolver = {
  solve(
    model: BatchOptimizationModel,
    objective: OptimizationObjective,
  ): BatchSolverSolution {
    if (model.serviceableCustomerIds.length === 0) {
      return {
        assignments: [],
        batchCountByRecipeId: {},
        metrics: {
          totalIngredientCost: 0,
          totalBatches: 0,
          recipeKinds: 0,
        },
      }
    }

    const {
      json,
      xNameByRecipeId,
      yNameByCustomerRecipe,
    } = buildJsonModel(model)

    const objectives: ObjectiveKey[] =
      objective === 'minimum-cost'
        ? ['cost', 'batches', 'kinds']
        : ['batches', 'cost', 'kinds']

    const result = solveLexicographically(json, objectives)
    const assignments = model.serviceableCustomerIds.flatMap(
      (customerId) => {
        const recipe = model.recipes.find((entry) => {
          const variableName = yNameByCustomerRecipe.get(
            `${customerId}\u001f${entry.candidate.id}`,
          )
          return variableName
            ? Number(result[variableName] ?? 0) > 0.5
            : false
        })

        if (!recipe) {
          throw new Error(
            `Solver returned no assignment for ${customerId}`,
          )
        }

        return [{
          customerId,
          recipeId: recipe.candidate.id,
        }]
      },
    )

    const batchCountByRecipeId: Record<string, number> = {}
    for (const recipe of model.recipes) {
      const variableName = xNameByRecipeId.get(recipe.candidate.id)
      const count = variableName
        ? Math.round(Number(result[variableName] ?? 0))
        : 0
      if (count > 0) {
        batchCountByRecipeId[recipe.candidate.id] = count
      }
    }

    const totalBatches = Object.values(batchCountByRecipeId)
      .reduce((sum, count) => sum + count, 0)
    const totalIngredientCost = model.recipes.reduce(
      (sum, recipe) =>
        sum +
        (batchCountByRecipeId[recipe.candidate.id] ?? 0) *
          recipe.batchIngredientCost,
      0,
    )

    return {
      assignments,
      batchCountByRecipeId,
      metrics: {
        totalIngredientCost,
        totalBatches,
        recipeKinds: Object.keys(batchCountByRecipeId).length,
      },
    }
  },
}
