import { Model, sum } from '@bubblyworld/highs-ts'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { PlanningUserError } from './planningErrors'
import type {
  BatchOptimizerSolver,
  BatchSolverSolution,
} from './optimizerSolver'
import {
  minimumJarTypeSwitchesForRecipeIds,
  normalizedInitialCarriedJuiceJars,
  type BatchOptimizationModel,
  type OptimizationCriterion,
} from './optimizerModel'

type ObjectiveKey =
  | 'cost'
  | 'productionUnits'
  | 'kinds'
  | 'negativeAssignedIngredientCost'
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

export interface HighsStageProfile {
  objective: ObjectiveKey
  fixCount: number
  variableCount: number
  constraintCount: number
  buildMs: number
  solveMs: number
  status: string
  objectiveValue: number
}

export interface HighsOptimizationProfile {
  stages: HighsStageProfile[]
  totalBuildMs: number
  totalSolveMs: number
  totalMs: number
  finalVariableCount: number
  finalConstraintCount: number
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
  if (criterion === 'maximum-ingredient-cost') {
    return 'negativeAssignedIngredientCost'
  }
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
        const edgeMultiplicity = recipe.productionPath.edges.filter(
          (edge) => edge.key === edgeKey,
        ).length
        if (edgeMultiplicity === 0) return []

        const x = xByRecipeId.get(recipe.candidate.id)
        return x ? [x.times(edgeMultiplicity)] : []
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

  const assignedIngredientCostExpression = sum(
    ...domain.serviceableCustomerIds.flatMap((customerId) =>
      domain.recipes.flatMap((recipe) => {
        const y = yByCustomerRecipe.get(
          `${customerId}\u001f${recipe.candidate.id}`,
        )
        return y ? [y.times(recipe.juiceUnitIngredientCost)] : []
      }),
    ),
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

  const initialJars = normalizedInitialCarriedJuiceJars(
    domain.request,
  )
  const emptyJarCount = initialJars.filter(
    (jar) => !jar.recipeId || jar.servings <= 0,
  ).length
  const initialRecipeIds = new Set(
    initialJars.flatMap((jar) =>
      jar.recipeId && jar.servings > 0 ? [jar.recipeId] : [],
    ),
  )
  const unmatchedKindExpression = sum(
    ...domain.recipes.flatMap((recipe) => {
      if (initialRecipeIds.has(recipe.candidate.id)) return []
      const z = zByRecipeId.get(recipe.candidate.id)
      return z ? [z] : []
    }),
  )
  const jarSwitches = model.intVar(
    0,
    Math.max(0, domain.recipes.length),
    'jar_type_switches',
  )
  model.addConstraint(
    unmatchedKindExpression
      .minus(jarSwitches)
      .leq(emptyJarCount),
    'jar_switch_lower_bound',
  )
  model.addConstraint(
    jarSwitches.minus(unmatchedKindExpression).leq(0),
    'jar_switch_usage',
  )

  if (emptyJarCount === 0) {
    const cumulativeServingsByRecipe = new Map<string, number>()
    const reusableJarVars: BoolVariable[] = []

    initialJars.forEach((jar, jarIndex) => {
      if (!jar.recipeId || jar.servings <= 0) return
      const cumulative =
        (cumulativeServingsByRecipe.get(jar.recipeId) ?? 0) +
        jar.servings
      cumulativeServingsByRecipe.set(jar.recipeId, cumulative)

      const assignedServings = sum(
        ...domain.serviceableCustomerIds.flatMap((customerId) => {
          const y = yByCustomerRecipe.get(
            `${customerId}\u001f${jar.recipeId}`,
          )
          return y ? [y] : []
        }),
      )
      const reusable = model.boolVar(
        `initial_jar_reusable_${jarIndex}`,
      )
      model.addConstraint(
        reusable.times(cumulative).minus(assignedServings).leq(0),
        `initial_jar_reusable_threshold_${jarIndex}`,
      )
      reusableJarVars.push(reusable)
    })

    if (reusableJarVars.length > 0) {
      model.addConstraint(
        unmatchedKindExpression
          .minus(
            sum(...reusableJarVars).times(
              Math.max(1, domain.recipes.length),
            ),
          )
          .leq(0),
        'initial_jar_switch_requires_reusable_jar',
      )
    } else {
      model.addConstraint(
        unmatchedKindExpression.leq(0),
        'initial_jar_switch_requires_reusable_jar',
      )
    }
  }

  const maxJarTypeSwitches =
    domain.request.constraints?.maxJarTypeSwitches
  if (
    typeof maxJarTypeSwitches === 'number' &&
    Number.isFinite(maxJarTypeSwitches)
  ) {
    model.addConstraint(
      unmatchedKindExpression.leq(
        emptyJarCount + Math.max(0, Math.floor(maxJarTypeSwitches)),
      ),
      'jar_switch_hard_limit',
    )
  }

  const expressions = {
    cost: costExpression,
    productionUnits: productionUnitsExpression,
    kinds: kindExpression,
    negativeAssignedIngredientCost:
      assignedIngredientCostExpression.times(-1),
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

  const nonEmptyInitialJarCount = initialJars.filter(
    (jar) => jar.recipeId && jar.servings > 0,
  ).length
  const reusableJarVariableCount =
    emptyJarCount === 0 ? nonEmptyInitialJarCount : 0
  const variableCount =
    domain.recipes.length * 2 +
    yByCustomerRecipe.size +
    operationByEdgeKey.size +
    1 +
    reusableJarVariableCount
  const constraintCount =
    domain.recipes.length * 3 +
    domain.serviceableCustomerIds.length +
    operationByEdgeKey.size * 2 +
    2 +
    fixes.length +
    (emptyJarCount === 0 ? nonEmptyInitialJarCount + 1 : 0) +
    (
      typeof maxJarTypeSwitches === 'number' &&
      Number.isFinite(maxJarTypeSwitches)
        ? 1
        : 0
    )

  return {
    model,
    xByRecipeId,
    yByCustomerRecipe,
    operationByEdgeKey,
    variableCount,
    constraintCount,
  }
}

export async function profileHighsOptimization(
  domain: BatchOptimizationModel,
  priorities: OptimizationCriterion[],
): Promise<HighsOptimizationProfile> {
  if (domain.serviceableCustomerIds.length === 0) {
    return {
      stages: [],
      totalBuildMs: 0,
      totalSolveMs: 0,
      totalMs: 0,
      finalVariableCount: 0,
      finalConstraintCount: 0,
    }
  }

  const totalStartedAt = performance.now()
  const objectives = objectiveOrder(priorities)
  const fixes: ObjectiveFix[] = []
  const stages: HighsStageProfile[] = []

  for (const objectiveKey of objectives) {
    const buildStartedAt = performance.now()
    const built = buildHighsStage(domain, objectiveKey, fixes)
    const buildMs = performance.now() - buildStartedAt

    const solveStartedAt = performance.now()
    const solution = await built.model.solve()
    const solveMs = performance.now() - solveStartedAt

    if (solution.status !== 'optimal') {
      throw new PlanningUserError(
        'optimizer-no-solution',
        { solverStatus: solution.status },
        `HiGHS optimizer ended with status: ${solution.status}`,
      )
    }

    const optimum = Math.round(
      requiredFiniteNumber(
        solution.objective,
        `${objectiveKey} objective`,
      ),
    )

    stages.push({
      objective: objectiveKey,
      fixCount: fixes.length,
      variableCount: built.variableCount,
      constraintCount: built.constraintCount,
      buildMs,
      solveMs,
      status: solution.status,
      objectiveValue: optimum,
    })
    fixes.push({
      objective: objectiveKey,
      value: optimum,
    })
  }

  const finalStage = stages.at(-1)
  return {
    stages,
    totalBuildMs: stages.reduce(
      (total, stage) => total + stage.buildMs,
      0,
    ),
    totalSolveMs: stages.reduce(
      (total, stage) => total + stage.solveMs,
      0,
    ),
    totalMs: performance.now() - totalStartedAt,
    finalVariableCount: finalStage?.variableCount ?? 0,
    finalConstraintCount: finalStage?.constraintCount ?? 0,
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
        throw new PlanningUserError(
          'optimizer-no-solution',
          { solverStatus: solution.status },
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
    const jarTypeSwitches = minimumJarTypeSwitchesForRecipeIds(
      domain.request,
      Object.keys(productionUnitsByRecipeId),
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
