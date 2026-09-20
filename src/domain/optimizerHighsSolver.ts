import { Model, sum } from '@bubblyworld/highs-ts'
import type {
  BatchOptimizerSolver,
  BatchSolverSolution,
} from './optimizerSolver'
import type {
  BatchOptimizationModel,
  OptimizationObjective,
} from './optimizerModel'

type ObjectiveKey = 'cost' | 'batches' | 'kinds'
type IntVariable = ReturnType<Model['intVar']>
type BoolVariable = ReturnType<Model['boolVar']>

interface ObjectiveFix {
  objective: ObjectiveKey
  value: number
}

function requiredFiniteNumber(
  value: number | undefined,
  label: string,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`HiGHS returned invalid ${label}`)
  }
  return value
}

function objectiveOrder(
  objective: OptimizationObjective,
): ObjectiveKey[] {
  return objective === 'minimum-cost'
    ? ['cost', 'batches', 'kinds']
    : ['batches', 'cost', 'kinds']
}

function buildHighsStage(
  domain: BatchOptimizationModel,
  objective: ObjectiveKey,
  fixes: ObjectiveFix[],
) {
  const model = new Model()
  const maxBatches = Math.max(
    1,
    Math.ceil(domain.serviceableCustomerIds.length / 2),
  )
  const xByRecipeId = new Map<string, IntVariable>()
  const zByRecipeId = new Map<string, BoolVariable>()
  const yByCustomerRecipe = new Map<string, BoolVariable>()

  domain.recipes.forEach((recipe, recipeIndex) => {
    const x = model.intVar(0, maxBatches, `x_${recipeIndex}`)
    const z = model.boolVar(`z_${recipeIndex}`)
    xByRecipeId.set(recipe.candidate.id, x)
    zByRecipeId.set(recipe.candidate.id, z)

    model.addConstraint(
      x.minus(z.times(maxBatches)).leq(0),
      `usage_${recipeIndex}`,
    )
  })

  domain.serviceableCustomerIds.forEach((customerId, customerIndex) => {
    const assignmentVars: BoolVariable[] = []

    domain.recipes.forEach((recipe, recipeIndex) => {
      if (!recipe.eligibleCustomerIds.includes(customerId)) return

      const y = model.boolVar(`y_${customerIndex}_${recipeIndex}`)
      yByCustomerRecipe.set(
        `${customerId}\u001f${recipe.candidate.id}`,
        y,
      )
      assignmentVars.push(y)
    })

    model.addConstraint(
      sum(...assignmentVars).eq(1),
      `customer_${customerIndex}`,
    )
  })

  domain.recipes.forEach((recipe, recipeIndex) => {
    const x = xByRecipeId.get(recipe.candidate.id)
    if (!x) return

    const assignmentVars = recipe.eligibleCustomerIds.flatMap(
      (customerId) => {
        const y = yByCustomerRecipe.get(
          `${customerId}\u001f${recipe.candidate.id}`,
        )
        return y ? [y] : []
      },
    )

    model.addConstraint(
      sum(...assignmentVars).minus(x.times(2)).leq(0),
      `capacity_${recipeIndex}`,
    )
  })

  const costExpression = sum(
    ...domain.recipes.flatMap((recipe) => {
      const x = xByRecipeId.get(recipe.candidate.id)
      return x ? [x.times(recipe.batchIngredientCost)] : []
    }),
  )
  const batchExpression = sum(
    ...domain.recipes.flatMap((recipe) => {
      const x = xByRecipeId.get(recipe.candidate.id)
      return x ? [x] : []
    }),
  )
  const kindExpression = sum(
    ...domain.recipes.flatMap((recipe) => {
      const z = zByRecipeId.get(recipe.candidate.id)
      return z ? [z] : []
    }),
  )
  const expressions = {
    cost: costExpression,
    batches: batchExpression,
    kinds: kindExpression,
  }

  fixes.forEach((fix, index) => {
    model.addConstraint(
      expressions[fix.objective].eq(fix.value),
      `fix_${fix.objective}_${index}`,
    )
  })

  model.minimize(expressions[objective])

  return {
    model,
    xByRecipeId,
    yByCustomerRecipe,
  }
}

export const highsSolverAdapter: BatchOptimizerSolver = {
  async solve(
    domain: BatchOptimizationModel,
    objective: OptimizationObjective,
  ): Promise<BatchSolverSolution> {
    if (domain.serviceableCustomerIds.length === 0) {
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

    const objectives = objectiveOrder(objective)
    const fixes: ObjectiveFix[] = []
    let final:
      | {
          built: ReturnType<typeof buildHighsStage>
          solution: Awaited<ReturnType<Model['solve']>>
        }
      | undefined

    for (const objectiveKey of objectives) {
      const built = buildHighsStage(domain, objectiveKey, fixes)
      const solution = await built.model.solve()

      if (solution.status !== 'optimal') {
        throw new Error(
          `HiGHS optimizer ended with status: ${solution.status}`,
        )
      }

      const optimum = Math.round(
        requiredFiniteNumber(solution.objective, `${objectiveKey} objective`),
      )
      final = { built, solution }
      fixes.push({
        objective: objectiveKey,
        value: optimum,
      })
    }

    if (!final) {
      throw new Error('HiGHS optimizer did not run')
    }

    const finalStage = final
    const assignments = domain.serviceableCustomerIds.map(
      (customerId) => {
        const recipe = domain.recipes.find((entry) => {
          const variable = finalStage.built.yByCustomerRecipe.get(
            `${customerId}\u001f${entry.candidate.id}`,
          )
          return variable
            ? requiredFiniteNumber(
                finalStage.solution.getValue(variable),
                `assignment ${customerId}/${entry.candidate.id}`,
              ) > 0.5
            : false
        })

        if (!recipe) {
          throw new Error(
            `HiGHS returned no assignment for ${customerId}`,
          )
        }

        return {
          customerId,
          recipeId: recipe.candidate.id,
        }
      },
    )

    const batchCountByRecipeId: Record<string, number> = {}
    for (const recipe of domain.recipes) {
      const variable = finalStage.built.xByRecipeId.get(recipe.candidate.id)
      const count = variable
        ? Math.round(
            requiredFiniteNumber(
              finalStage.solution.getValue(variable),
              `batch count ${recipe.candidate.id}`,
            ),
          )
        : 0

      if (count > 0) {
        batchCountByRecipeId[recipe.candidate.id] = count
      }
    }

    const totalBatches = Object.values(batchCountByRecipeId)
      .reduce((sum, count) => sum + count, 0)
    const totalIngredientCost = domain.recipes.reduce(
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
