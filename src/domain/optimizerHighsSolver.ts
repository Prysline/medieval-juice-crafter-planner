import { HiGHS, Model, sum } from '@bubblyworld/highs-ts'
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

export interface HighsBuildPhaseProfile {
  recipeUsageMs: number
  customerAssignmentsMs: number
  recipeCapacityMs: number
  productionOperationsMs: number
  baseObjectivesMs: number
  assignedIngredientCostMs: number
  knownRevenueMs: number
  jarSwitchesMs: number
  fixesAndObjectiveMs: number
}

export interface HighsStageProfile {
  objective: ObjectiveKey
  fixCount: number
  variableCount: number
  constraintCount: number
  assignmentVariablesRelaxed: boolean
  fractionalAssignmentVariableCount: number
  maxAssignmentIntegralityError: number
  integralAssignmentReconstructionFeasible: boolean | null
  reconstructedAssignmentCount: number
  selectedRecipeUnits: Array<{
    recipeId: string
    units: number
  }>
  buildMs: number
  buildPhases: HighsBuildPhaseProfile
  serializeMs: number
  wasmCreateMs: number
  parseMs: number
  solveMs: number
  status: string
  objectiveValue: number | null
}

export interface HighsOptimizationProfile {
  stages: HighsStageProfile[]
  totalBuildMs: number
  totalSerializeMs: number
  totalWasmCreateMs: number
  totalParseMs: number
  totalSolveMs: number
  totalMs: number
  finalVariableCount: number
  finalConstraintCount: number
  terminatedAtObjective: ObjectiveKey | null
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

function reconstructIntegralAssignments(
  domain: BatchOptimizationModel,
  built: {
    xByRecipeId: Map<string, IntVariable>
  },
  values: Map<string, number>,
): {
  feasible: boolean
  assignedCount: number
} {
  const capacityByRecipeId = new Map<string, number>()
  for (const recipe of domain.recipes) {
    const x = built.xByRecipeId.get(recipe.candidate.id)
    const units = x ? values.get(x.name) ?? 0 : 0
    const capacity = Math.max(0, Math.round(units) * 2)
    if (capacity > 0) {
      capacityByRecipeId.set(recipe.candidate.id, capacity)
    }
  }

  const eligibleRecipeIdsByCustomer = new Map<string, string[]>()
  for (const customerId of domain.serviceableCustomerIds) {
    eligibleRecipeIdsByCustomer.set(
      customerId,
      domain.recipes.flatMap((recipe) =>
        capacityByRecipeId.has(recipe.candidate.id) &&
        recipe.eligibleCustomerIds.includes(customerId)
          ? [recipe.candidate.id]
          : [],
      ),
    )
  }

  const assignedCustomersByRecipe = new Map<string, string[]>()

  function tryAssign(
    customerId: string,
    visitedRecipeIds: Set<string>,
    visitedCustomerIds: Set<string>,
  ): boolean {
    for (const recipeId of eligibleRecipeIdsByCustomer.get(customerId) ?? []) {
      if (visitedRecipeIds.has(recipeId)) continue
      visitedRecipeIds.add(recipeId)

      const assigned = assignedCustomersByRecipe.get(recipeId) ?? []
      const capacity = capacityByRecipeId.get(recipeId) ?? 0
      if (assigned.length < capacity) {
        assigned.push(customerId)
        assignedCustomersByRecipe.set(recipeId, assigned)
        return true
      }

      for (let index = 0; index < assigned.length; index += 1) {
        const displacedCustomerId = assigned[index]
        if (visitedCustomerIds.has(displacedCustomerId)) continue
        visitedCustomerIds.add(displacedCustomerId)

        if (
          tryAssign(
            displacedCustomerId,
            visitedRecipeIds,
            visitedCustomerIds,
          )
        ) {
          assigned[index] = customerId
          assignedCustomersByRecipe.set(recipeId, assigned)
          return true
        }
      }
    }

    return false
  }

  let assignedCount = 0
  for (const customerId of domain.serviceableCustomerIds) {
    if (
      !tryAssign(
        customerId,
        new Set<string>(),
        new Set<string>([customerId]),
      )
    ) {
      return {
        feasible: false,
        assignedCount,
      }
    }
    assignedCount += 1
  }

  return {
    feasible: true,
    assignedCount,
  }
}

function buildHighsStage(
  domain: BatchOptimizationModel,
  objective: ObjectiveKey,
  fixes: ObjectiveFix[],
  options: {
    relaxAssignmentVariables?: boolean
    aggregateLocalSingletonOperations?: boolean
    aggregateEquivalentAssignments?: boolean
    tightenRecipeBoundsFromMinimumCostFix?: boolean
    machineOperationsUpperBound?: number
  } = {},
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
  const buildPhaseMs: HighsBuildPhaseProfile = {
    recipeUsageMs: 0,
    customerAssignmentsMs: 0,
    recipeCapacityMs: 0,
    productionOperationsMs: 0,
    baseObjectivesMs: 0,
    assignedIngredientCostMs: 0,
    knownRevenueMs: 0,
    jarSwitchesMs: 0,
    fixesAndObjectiveMs: 0,
  }
  const neededObjectiveKeys = new Set<ObjectiveKey>([
    objective,
    ...fixes.map((fix) => fix.objective),
  ])
  const needsAnyObjective = (...keys: ObjectiveKey[]) =>
    keys.some((key) => neededObjectiveKeys.has(key))
  const initialJars = normalizedInitialCarriedJuiceJars(
    domain.request,
  )
  const emptyJarCount = initialJars.filter(
    (jar) => !jar.recipeId || jar.servings <= 0,
  ).length
  const maxJarTypeSwitches =
    domain.request.constraints?.maxJarTypeSwitches
  const hasJarHardConstraint =
    emptyJarCount === 0 ||
    (
      typeof maxJarTypeSwitches === 'number' &&
      Number.isFinite(maxJarTypeSwitches)
    )
  const needsJarStructure =
    needsAnyObjective('jarSwitches') || hasJarHardConstraint
  const needsRecipeUsageStructure =
    needsAnyObjective('kinds') || needsJarStructure
  const needsProductionOperations =
    needsAnyObjective('machineOperations')
  const needsRecipeSpecificAssignments = needsAnyObjective(
    'negativeAssignedIngredientCost',
    'negativeKnownRevenue',
    'negativeKnownGrossProfit',
  )
  if (
    options.aggregateEquivalentAssignments &&
    needsRecipeSpecificAssignments
  ) {
    throw new Error(
      'Grouped assignments cannot be used with assignment-sensitive objectives',
    )
  }

  const assignmentGroups = (() => {
    if (!options.aggregateEquivalentAssignments) {
      return domain.recipes.map((recipe) => ({
        key: recipe.candidate.id,
        recipes: [recipe],
        eligibleCustomerIds: recipe.eligibleCustomerIds,
      }))
    }

    const groupsByEligibility = new Map<
      string,
      {
        key: string
        recipes: typeof domain.recipes
        eligibleCustomerIds: string[]
      }
    >()

    for (const recipe of domain.recipes) {
      const eligibleCustomerIds = [
        ...recipe.eligibleCustomerIds,
      ].sort()
      const key = eligibleCustomerIds.join('\u001e')
      const group = groupsByEligibility.get(key)
      if (group) {
        group.recipes.push(recipe)
      } else {
        groupsByEligibility.set(key, {
          key,
          recipes: [recipe],
          eligibleCustomerIds,
        })
      }
    }

    return [...groupsByEligibility.values()]
  })()

  const fixedMinimumCost = fixes.find(
    (fix) => fix.objective === 'cost',
  )?.value

  let phaseStartedAt = performance.now()
  domain.recipes.forEach((recipe, recipeIndex) => {
    const customerCapacityUpperBound = Math.max(
      1,
      Math.ceil(recipe.eligibleCustomerIds.length / 2),
    )
    const costUpperBound =
      options.tightenRecipeBoundsFromMinimumCostFix &&
      typeof fixedMinimumCost === 'number' &&
      fixedMinimumCost >= 0 &&
      recipe.juiceUnitIngredientCost > 0
        ? Math.floor(
            fixedMinimumCost / recipe.juiceUnitIngredientCost,
          )
        : maxJuiceUnitsPerRecipe
    const recipeUpperBound =
      options.tightenRecipeBoundsFromMinimumCostFix
        ? Math.max(
            0,
            Math.min(
              maxJuiceUnitsPerRecipe,
              customerCapacityUpperBound,
              costUpperBound,
            ),
          )
        : maxJuiceUnitsPerRecipe

    const x = model.intVar(
      0,
      recipeUpperBound,
      `x_${recipeIndex}`,
    )
    xByRecipeId.set(recipe.candidate.id, x)

    if (needsRecipeUsageStructure) {
      const z = model.boolVar(`z_${recipeIndex}`)
      zByRecipeId.set(recipe.candidate.id, z)

      model.addConstraint(
        x.minus(z.times(maxJuiceUnitsPerRecipe)).leq(0),
        `usage_upper_${recipeIndex}`,
      )
      model.addConstraint(
        z.minus(x).leq(0),
        `usage_lower_${recipeIndex}`,
      )
    }
  })
  buildPhaseMs.recipeUsageMs = performance.now() - phaseStartedAt

  phaseStartedAt = performance.now()
  domain.serviceableCustomerIds.forEach((customerId, customerIndex) => {
    const assignmentVars: BoolVariable[] = []

    assignmentGroups.forEach((group, groupIndex) => {
      if (!group.eligibleCustomerIds.includes(customerId)) return

      const y = options.relaxAssignmentVariables
        ? model.numVar(0, 1, `y_${customerIndex}_${groupIndex}`)
        : model.boolVar(`y_${customerIndex}_${groupIndex}`)
      yByCustomerRecipe.set(
        `${customerId}\u001f${group.key}`,
        y,
      )
      assignmentVars.push(y)
    })

    model.addConstraint(
      sum(...assignmentVars).eq(1),
      `customer_${customerIndex}`,
    )
  })
  buildPhaseMs.customerAssignmentsMs = performance.now() - phaseStartedAt

  phaseStartedAt = performance.now()
  assignmentGroups.forEach((group, groupIndex) => {
    const assignmentVars = group.eligibleCustomerIds.flatMap(
      (customerId) => {
        const y = yByCustomerRecipe.get(
          `${customerId}\u001f${group.key}`,
        )
        return y ? [y] : []
      },
    )
    const capacityTerms = group.recipes.flatMap((recipe) => {
      const x = xByRecipeId.get(recipe.candidate.id)
      return x ? [x.times(2)] : []
    })

    model.addConstraint(
      sum(...assignmentVars)
        .minus(sum(...capacityTerms))
        .leq(0),
      `capacity_${groupIndex}`,
    )
  })
  buildPhaseMs.recipeCapacityMs = performance.now() - phaseStartedAt

  phaseStartedAt = performance.now()
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<IntVariable['times']>[]
  >()
  const machineOperationTerms: ReturnType<IntVariable['times']>[] = []
  const operationByEdgeKey = new Map<string, IntVariable>()

  if (needsProductionOperations) {
    const edgeMultiplicityByRecipe = new Map<
      string,
      Map<string, number>
    >()
    const recipeCountByEdgeKey = new Map<string, number>()

    for (const recipe of domain.recipes) {
      const edgeMultiplicityByKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        edgeMultiplicityByKey.set(
          edge.key,
          (edgeMultiplicityByKey.get(edge.key) ?? 0) + 1,
        )
      }
      edgeMultiplicityByRecipe.set(
        recipe.candidate.id,
        edgeMultiplicityByKey,
      )

      for (const edgeKey of edgeMultiplicityByKey.keys()) {
        recipeCountByEdgeKey.set(
          edgeKey,
          (recipeCountByEdgeKey.get(edgeKey) ?? 0) + 1,
        )
      }
    }

    let localOperationIndex = 0
    for (const recipe of domain.recipes) {
      const x = xByRecipeId.get(recipe.candidate.id)
      if (!x) continue

      const edgeMultiplicityByKey =
        edgeMultiplicityByRecipe.get(recipe.candidate.id) ??
        new Map<string, number>()
      const localEdgeCountByMultiplicity = new Map<number, number>()

      for (const [edgeKey, multiplicity] of edgeMultiplicityByKey) {
        if (
          options.aggregateLocalSingletonOperations &&
          recipeCountByEdgeKey.get(edgeKey) === 1
        ) {
          localEdgeCountByMultiplicity.set(
            multiplicity,
            (localEdgeCountByMultiplicity.get(multiplicity) ?? 0) + 1,
          )
          continue
        }

        const term = x.times(multiplicity)
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        if (terms) {
          terms.push(term)
        } else {
          quantityTermsByEdgeKey.set(edgeKey, [term])
        }
      }

      for (const [multiplicity, localEdgeCount] of
        localEdgeCountByMultiplicity) {
        const operationCount = model.intVar(
          0,
          maxTotalJuiceUnits,
          `local_op_${localOperationIndex}`,
        )
        operationByEdgeKey.set(
          `local:${recipe.candidate.id}:m${multiplicity}`,
          operationCount,
        )
        const quantityExpression = x.times(multiplicity)

        model.addConstraint(
          quantityExpression
            .minus(
              operationCount.times(PROCESSING_STACK_CAPACITY),
            )
            .leq(0),
          `local_operation_capacity_${localOperationIndex}`,
        )
        model.addConstraint(
          operationCount.minus(quantityExpression).leq(0),
          `local_operation_usage_${localOperationIndex}`,
        )
        machineOperationTerms.push(
          operationCount.times(localEdgeCount),
        )
        localOperationIndex += 1
      }
    }

    ;[...quantityTermsByEdgeKey.entries()].forEach(
      ([edgeKey, quantityTerms], edgeIndex) => {
        const operationCount = model.intVar(
          0,
          maxTotalJuiceUnits,
          `op_${edgeIndex}`,
        )
        operationByEdgeKey.set(edgeKey, operationCount)

        const quantityExpression = sum(...quantityTerms)

        model.addConstraint(
          quantityExpression
            .minus(
              operationCount.times(PROCESSING_STACK_CAPACITY),
            )
            .leq(0),
          `operation_capacity_${edgeIndex}`,
        )
        model.addConstraint(
          operationCount.minus(quantityExpression).leq(0),
          `operation_usage_${edgeIndex}`,
        )
        machineOperationTerms.push(operationCount.times(1))
      },
    )
  }
  buildPhaseMs.productionOperationsMs =
    performance.now() - phaseStartedAt

  phaseStartedAt = performance.now()
  const costExpression = needsAnyObjective(
    'cost',
    'negativeKnownGrossProfit',
  )
    ? sum(
        ...domain.recipes.flatMap((recipe) => {
          const x = xByRecipeId.get(recipe.candidate.id)
          return x ? [x.times(recipe.juiceUnitIngredientCost)] : []
        }),
      )
    : undefined
  const productionUnitsExpression = needsAnyObjective('productionUnits')
    ? sum(
        ...domain.recipes.flatMap((recipe) => {
          const x = xByRecipeId.get(recipe.candidate.id)
          return x ? [x] : []
        }),
      )
    : undefined
  const kindExpression = needsAnyObjective('kinds')
    ? sum(
        ...domain.recipes.flatMap((recipe) => {
          const z = zByRecipeId.get(recipe.candidate.id)
          return z ? [z] : []
        }),
      )
    : undefined
  const machineOperationsExpression = needsAnyObjective('machineOperations')
    ? sum(...machineOperationTerms)
    : undefined
  if (
    machineOperationsExpression &&
    typeof options.machineOperationsUpperBound === 'number' &&
    Number.isFinite(options.machineOperationsUpperBound)
  ) {
    model.addConstraint(
      machineOperationsExpression.leq(
        Math.max(
          0,
          Math.floor(options.machineOperationsUpperBound),
        ),
      ),
      'machine_operations_upper_bound',
    )
  }
  buildPhaseMs.baseObjectivesMs = performance.now() - phaseStartedAt

  phaseStartedAt = performance.now()
  const assignedIngredientCostExpression = needsAnyObjective(
    'negativeAssignedIngredientCost',
  )
    ? sum(
        ...domain.serviceableCustomerIds.flatMap((customerId) =>
          domain.recipes.flatMap((recipe) => {
            const y = yByCustomerRecipe.get(
              `${customerId}\u001f${recipe.candidate.id}`,
            )
            return y ? [y.times(recipe.juiceUnitIngredientCost)] : []
          }),
        ),
      )
    : undefined
  buildPhaseMs.assignedIngredientCostMs =
    performance.now() - phaseStartedAt

  phaseStartedAt = performance.now()
  const formalCustomerIds = new Set(domain.request.formalCustomerIds)
  const knownRevenueExpression = needsAnyObjective(
    'negativeKnownRevenue',
    'negativeKnownGrossProfit',
  )
    ? sum(
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
    : undefined
  buildPhaseMs.knownRevenueMs = performance.now() - phaseStartedAt

  phaseStartedAt = performance.now()
  let jarSwitches: IntVariable | undefined
  let reusableJarVariableCount = 0

  if (needsJarStructure) {
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
    jarSwitches = model.intVar(
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
      reusableJarVariableCount = reusableJarVars.length
    }

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
  }
  buildPhaseMs.jarSwitchesMs = performance.now() - phaseStartedAt

  phaseStartedAt = performance.now()
  const expressions = {
    cost: costExpression,
    productionUnits: productionUnitsExpression,
    kinds: kindExpression,
    negativeAssignedIngredientCost:
      assignedIngredientCostExpression?.times(-1),
    negativeKnownRevenue: knownRevenueExpression?.times(-1),
    negativeKnownGrossProfit:
      costExpression && knownRevenueExpression
        ? costExpression.minus(knownRevenueExpression)
        : undefined,
    machineOperations: machineOperationsExpression,
    jarSwitches,
  }

  const requiredObjectiveExpression = (key: ObjectiveKey) => {
    const expression = expressions[key]
    if (!expression) {
      throw new Error(`Missing HiGHS expression for objective ${key}`)
    }
    return expression
  }

  fixes.forEach((fix, index) => {
    model.addConstraint(
      requiredObjectiveExpression(fix.objective).eq(fix.value),
      `fix_${fix.objective}_${index}`,
    )
  })

  model.minimize(requiredObjectiveExpression(objective))
  buildPhaseMs.fixesAndObjectiveMs = performance.now() - phaseStartedAt

  const variableCount =
    domain.recipes.length +
    (needsRecipeUsageStructure ? domain.recipes.length : 0) +
    yByCustomerRecipe.size +
    operationByEdgeKey.size +
    (needsJarStructure ? 1 : 0) +
    reusableJarVariableCount
  const constraintCount =
    assignmentGroups.length +
    (needsRecipeUsageStructure ? domain.recipes.length * 2 : 0) +
    domain.serviceableCustomerIds.length +
    operationByEdgeKey.size * 2 +
    (needsJarStructure ? 2 : 0) +
    fixes.length +
    (
      needsJarStructure && emptyJarCount === 0
        ? reusableJarVariableCount + 1
        : 0
    ) +
    (
      needsJarStructure &&
      typeof maxJarTypeSwitches === 'number' &&
      Number.isFinite(maxJarTypeSwitches)
        ? 1
        : 0
    ) +
    (
      needsProductionOperations &&
      typeof options.machineOperationsUpperBound === 'number' &&
      Number.isFinite(options.machineOperationsUpperBound)
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
    buildPhaseMs,
  }
}

export async function profileHighsOptimization(
  domain: BatchOptimizationModel,
  priorities: OptimizationCriterion[],
  options: {
    stageTimeLimitSeconds?: number
    relaxAssignmentVariables?: boolean
    maxStages?: number
    aggregateLocalSingletonOperations?: boolean
    aggregateEquivalentAssignments?: boolean
    tightenRecipeBoundsFromMinimumCostFix?: boolean
    machineOperationsUpperBound?: number
    initialCriterionFixes?: Array<{
      criterion: OptimizationCriterion
      value: number
    }>
  } = {},
): Promise<HighsOptimizationProfile> {
  if (domain.serviceableCustomerIds.length === 0) {
    return {
      stages: [],
      totalBuildMs: 0,
      totalSerializeMs: 0,
      totalWasmCreateMs: 0,
      totalParseMs: 0,
      totalSolveMs: 0,
      totalMs: 0,
      finalVariableCount: 0,
      finalConstraintCount: 0,
      terminatedAtObjective: null,
    }
  }

  const totalStartedAt = performance.now()
  const objectives = objectiveOrder(priorities)
  const fixes: ObjectiveFix[] = (
    options.initialCriterionFixes ?? []
  ).map((fix) => ({
    objective: criterionKey(fix.criterion),
    value: fix.value,
  }))
  const stages: HighsStageProfile[] = []
  const stageTimeLimitSeconds =
    options.stageTimeLimitSeconds ?? 10.5
  let terminatedAtObjective: ObjectiveKey | null = null

  for (const objectiveKey of objectives) {
    const buildStartedAt = performance.now()
    const built = buildHighsStage(
      domain,
      objectiveKey,
      fixes,
      {
        relaxAssignmentVariables:
          options.relaxAssignmentVariables ?? false,
        aggregateLocalSingletonOperations:
          options.aggregateLocalSingletonOperations ?? false,
        aggregateEquivalentAssignments:
          options.aggregateEquivalentAssignments ?? false,
        tightenRecipeBoundsFromMinimumCostFix:
          options.tightenRecipeBoundsFromMinimumCostFix ?? false,
        machineOperationsUpperBound:
          options.machineOperationsUpperBound,
      },
    )
    const buildMs = performance.now() - buildStartedAt

    const serializeStartedAt = performance.now()
    const mps = built.model.print('mps')
    const serializeMs = performance.now() - serializeStartedAt

    const wasmCreateStartedAt = performance.now()
    const highs = await HiGHS.create()
    const wasmCreateMs = performance.now() - wasmCreateStartedAt

    let parseMs = 0
    let solveMs = 0
    let status = 'unknown'
    let objectiveValue: number | null = null
    let fractionalAssignmentVariableCount = 0
    let maxAssignmentIntegralityError = 0
    let integralAssignmentReconstructionFeasible: boolean | null = null
    let reconstructedAssignmentCount = 0
    const selectedRecipeUnits: Array<{
      recipeId: string
      units: number
    }> = []

    try {
      const parseStartedAt = performance.now()
      await highs.parse(mps, 'mps')
      parseMs = performance.now() - parseStartedAt

      // highs-ts 1.3.0 dispatches integer JS numbers to the integer-option
      // setter. HiGHS time_limit is a real option, so keep this diagnostic
      // value non-integer without changing the requested practical bound.
      const realTimeLimit = Number.isInteger(stageTimeLimitSeconds)
        ? stageTimeLimitSeconds + 1e-6
        : stageTimeLimitSeconds
      highs.setParam(
        'time_limit',
        Math.max(0.1, realTimeLimit),
      )

      const solveStartedAt = performance.now()
      const solution = await highs.solve()
      solveMs = performance.now() - solveStartedAt
      status = solution.status
      objectiveValue =
        typeof solution.objective === 'number' &&
        Number.isFinite(solution.objective)
          ? solution.objective
          : null

      if (solution.solution) {
        for (const [recipeId, x] of built.xByRecipeId) {
          const units = solution.solution.get(x.name) ?? 0
          if (units > 1e-7) {
            selectedRecipeUnits.push({
              recipeId,
              units,
            })
          }
        }
      }

      if (
        options.relaxAssignmentVariables &&
        solution.solution
      ) {
        for (const [name, value] of solution.solution) {
          if (!name.startsWith('y_')) continue
          const integralityError = Math.abs(value - Math.round(value))
          if (integralityError > 1e-7) {
            fractionalAssignmentVariableCount += 1
          }
          maxAssignmentIntegralityError = Math.max(
            maxAssignmentIntegralityError,
            integralityError,
          )
        }

        const reconstruction = reconstructIntegralAssignments(
          domain,
          built,
          solution.solution,
        )
        integralAssignmentReconstructionFeasible =
          reconstruction.feasible
        reconstructedAssignmentCount =
          reconstruction.assignedCount
      }
    } finally {
      highs.free()
    }

    stages.push({
      objective: objectiveKey,
      fixCount: fixes.length,
      variableCount: built.variableCount,
      constraintCount: built.constraintCount,
      assignmentVariablesRelaxed:
        options.relaxAssignmentVariables ?? false,
      fractionalAssignmentVariableCount,
      maxAssignmentIntegralityError,
      integralAssignmentReconstructionFeasible,
      reconstructedAssignmentCount,
      selectedRecipeUnits,
      buildMs,
      buildPhases: built.buildPhaseMs,
      serializeMs,
      wasmCreateMs,
      parseMs,
      solveMs,
      status,
      objectiveValue,
    })

    if (status !== 'optimal' || objectiveValue === null) {
      terminatedAtObjective = objectiveKey
      break
    }

    if (
      typeof options.maxStages === 'number' &&
      stages.length >= options.maxStages
    ) {
      break
    }

    fixes.push({
      objective: objectiveKey,
      value: Math.round(objectiveValue),
    })
  }

  const finalStage = stages.at(-1)
  return {
    stages,
    totalBuildMs: stages.reduce(
      (total, stage) => total + stage.buildMs,
      0,
    ),
    totalSerializeMs: stages.reduce(
      (total, stage) => total + stage.serializeMs,
      0,
    ),
    totalWasmCreateMs: stages.reduce(
      (total, stage) => total + stage.wasmCreateMs,
      0,
    ),
    totalParseMs: stages.reduce(
      (total, stage) => total + stage.parseMs,
      0,
    ),
    totalSolveMs: stages.reduce(
      (total, stage) => total + stage.solveMs,
      0,
    ),
    totalMs: performance.now() - totalStartedAt,
    finalVariableCount: finalStage?.variableCount ?? 0,
    finalConstraintCount: finalStage?.constraintCount ?? 0,
    terminatedAtObjective,
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
