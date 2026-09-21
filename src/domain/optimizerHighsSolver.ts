import { Model, sum } from '@bubblyworld/highs-ts'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import type {
  BatchOptimizerSolver,
  BatchSolverSolution,
} from './optimizerSolver'
import {
  normalizedAvailableJuiceJarCount,
  type BatchOptimizationModel,
  type OptimizationCriterion,
} from './optimizerModel'

type ObjectiveKey =
  | 'cost'
  | 'productionUnits'
  | 'kinds'
  | 'negativeKnownRevenue'
  | 'negativeKnownGrossProfit'
  | 'machineOperations'
  | 'jarSwitches'

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

function criterionKey(
  criterion: OptimizationCriterion,
): ObjectiveKey {
  if (criterion === 'minimum-cost') return 'cost'
  if (criterion === 'minimum-waste') return 'productionUnits'
  if (criterion === 'maximum-known-revenue') return 'negativeKnownRevenue'
  if (criterion === 'maximum-known-gross-profit') {
    return 'negativeKnownGrossProfit'
  }
  if (criterion === 'minimum-machine-operations') {
    return 'machineOperations'
  }
  return 'jarSwitches'
}

function objectiveOrder(
  priorities: OptimizationCriterion[],
): ObjectiveKey[] {
  const explicit = priorities.map(criterionKey)
  const fallback: ObjectiveKey[] = [
    'cost',
    'productionUnits',
    'machineOperations',
    'kinds',
  ]
  return [...new Set([...explicit, ...fallback])]
}

function buildHighsStage(
  domain: BatchOptimizationModel,
  objective: ObjectiveKey,
  fixes: ObjectiveFix[],
) {
  const model = new Model()
  const maxJuiceUnitsPerRecipe = Math.max(
    1,
    Math.ceil(domain.serviceableCustomerIds.length / 2),
  )
  const maxTotalJuiceUnits = Math.max(
    1,
    domain.serviceableCustomerIds.length,
  )
  const xByRecipeId = new Map<string, IntVariable>()
  const zByRecipeId = new Map<string, BoolVariable>()
  const yByCustomerRecipe = new Map<string, BoolVariable>()

  domain.recipes.forEach((recipe, recipeIndex) => {
    const x = model.intVar(
      0,
      maxJuiceUnitsPerRecipe,
      `x_${recipeIndex}`,
    )
    const z = model.boolVar(`z_${recipeIndex}`)
    xByRecipeId.set(recipe.candidate.id, x)
    zByRecipeId.set(recipe.candidate.id, z)

    model.addConstraint(
      x.minus(z.times(maxJuiceUnitsPerRecipe)).leq(0),
      `usage_upper_${recipeIndex}`,
    )
    model.addConstraint(
      z.minus(x).leq(0),
      `usage_lower_${recipeIndex}`,
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

  const productionEdgeKeys = [
    ...new Set(
      domain.recipes.flatMap((recipe) =>
        recipe.productionPath.edges.map((edge) => edge.key),
      ),
    ),
  ]
  const operationByEdgeKey = new Map<string, IntVariable>()

  productionEdgeKeys.forEach((edgeKey, edgeIndex) => {
    const operationCount = model.intVar(
      0,
      maxTotalJuiceUnits,
      `op_${edgeIndex}`,
    )
    operationByEdgeKey.set(edgeKey, operationCount)

    const quantityExpression = sum(
      ...domain.recipes.flatMap((recipe) => {
        if (!recipe.productionPath.edges.some((edge) => edge.key === edgeKey)) {
          return []
        }
        const x = xByRecipeId.get(recipe.candidate.id)
        return x ? [x] : []
      }),
    )

    model.addConstraint(
      quantityExpression
        .minus(operationCount.times(PROCESSING_STACK_CAPACITY))
        .leq(0),
      `operation_capacity_${edgeIndex}`,
    )
    model.addConstraint(
      operationCount.minus(quantityExpression).leq(0),
      `operation_usage_${edgeIndex}`,
    )
  })

  const costExpression = sum(
    ...domain.recipes.flatMap((recipe) => {
      const x = xByRecipeId.get(recipe.candidate.id)
      return x ? [x.times(recipe.juiceUnitIngredientCost)] : []
    }),
  )
  const productionUnitsExpression = sum(
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
  const machineOperationsExpression = sum(
    ...operationByEdgeKey.values(),
  )

  const formalCustomerIds = new Set(domain.request.formalCustomerIds)
  const knownRevenueExpression = sum(
    ...domain.serviceableCustomerIds.flatMap((customerId) => {
      if (!formalCustomerIds.has(customerId)) return []

      return domain.recipes.flatMap((recipe) => {
        const salePrice = recipe.candidate.salePrice
        if (salePrice === null) return []

        const y = yByCustomerRecipe.get(
          `${customerId}\u001f${recipe.candidate.id}`,
        )
        return y ? [y.times(salePrice)] : []
      })
    }),
  )

  const availableJars = normalizedAvailableJuiceJarCount(domain.request)
  const jarSwitches = model.intVar(
    0,
    Math.max(0, domain.recipes.length),
    'jar_type_switches',
  )
  model.addConstraint(
    kindExpression.minus(jarSwitches).leq(availableJars),
    'jar_switch_lower_bound',
  )
  model.addConstraint(
    jarSwitches.minus(kindExpression).leq(0),
    'jar_switch_usage',
  )

  const maxJarTypeSwitches =
    domain.request.constraints?.maxJarTypeSwitches
  if (
    typeof maxJarTypeSwitches === 'number' &&
    Number.isFinite(maxJarTypeSwitches)
  ) {
    model.addConstraint(
      jarSwitches.leq(Math.max(0, Math.floor(maxJarTypeSwitches))),
      'jar_switch_hard_limit',
    )
  }

  const expressions = {
    cost: costExpression,
    productionUnits: productionUnitsExpression,
    kinds: kindExpression,
    negativeKnownRevenue: knownRevenueExpression.times(-1),
    negativeKnownGrossProfit: costExpression.minus(knownRevenueExpression),
    machineOperations: machineOperationsExpression,
    jarSwitches,
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
    operationByEdgeKey,
  }
}

export const highsSolverAdapter: BatchOptimizerSolver = {
  async solve(
    domain: BatchOptimizationModel,
    priorities: OptimizationCriterion[],
  ): Promise<BatchSolverSolution> {
    if (domain.serviceableCustomerIds.length === 0) {
      return {
        assignments: [],
        productionUnitsByRecipeId: {},
        metrics: {
          totalIngredientCost: 0,
          totalProductionUnits: 0,
          recipeKinds: 0,
          machineOperations: 0,
          jarTypeSwitches: 0,
        },
      }
    }

    const objectives = objectiveOrder(priorities)
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

    const productionUnitsByRecipeId: Record<string, number> = {}
    for (const recipe of domain.recipes) {
      const variable = finalStage.built.xByRecipeId.get(recipe.candidate.id)
      const count = variable
        ? Math.round(
            requiredFiniteNumber(
              finalStage.solution.getValue(variable),
              `production units ${recipe.candidate.id}`,
            ),
          )
        : 0

      if (count > 0) {
        productionUnitsByRecipeId[recipe.candidate.id] = count
      }
    }

    const totalProductionUnits = Object.values(productionUnitsByRecipeId)
      .reduce((total, count) => total + count, 0)
    const totalIngredientCost = domain.recipes.reduce(
      (total, recipe) =>
        total +
        (productionUnitsByRecipeId[recipe.candidate.id] ?? 0) *
          recipe.juiceUnitIngredientCost,
      0,
    )
    const recipeKinds = Object.keys(productionUnitsByRecipeId).length
    const machineOperations = [...finalStage.built.operationByEdgeKey.values()]
      .reduce(
        (total, variable) =>
          total +
          Math.round(
            requiredFiniteNumber(
              finalStage.solution.getValue(variable),
              'machine operation count',
            ),
          ),
        0,
      )
    const jarTypeSwitches = Math.max(
      0,
      recipeKinds - normalizedAvailableJuiceJarCount(domain.request),
    )

    return {
      assignments,
      productionUnitsByRecipeId,
      metrics: {
        totalIngredientCost,
        totalProductionUnits,
        recipeKinds,
        machineOperations,
        jarTypeSwitches,
      },
    }
  },
}
