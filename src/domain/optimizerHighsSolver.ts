import { Model, sum } from '@bubblyworld/highs-ts'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import {
  finalizingEdgesAreRecipeIdentityUnique,
  machineOperationBreakdownForSelection,
  minimumRecipeKindsFromFinalizingBound,
  prepareMinimumCostStageCertificate,
  repairMachineOperationWitness,
  type RecipeUnitSelection,
} from './optimizerCertificates'
import { PlanningUserError } from './planningErrors'
import type { ProductionStepKind } from './productionPlan'
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

const PRODUCTION_CERTIFICATE_RECIPE_COUNT_GATE = 3000

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

interface HighsStageOptions {
  relaxAssignmentVariables?: boolean
  aggregateEquivalentAssignments?: boolean
  tightenRecipeBoundsFromMinimumCostFix?: boolean
  tightenOperationBoundsFromRecipeBounds?: boolean
  machineOperationKinds?: Set<ProductionStepKind>
  fixedRecipeUnits?: Map<string, number>
  productionUnitsLowerBound?: number
}

function buildHighsStage(
  domain: BatchOptimizationModel,
  objective: ObjectiveKey,
  fixes: ObjectiveFix[],
  options: HighsStageOptions = {},
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
  const fixedMinimumCost = fixes.find(
    (fix) => fix.objective === 'cost',
  )?.value
  const xByRecipeId = new Map<string, IntVariable>()
  const recipeUpperBoundById = new Map<string, number>()
  const zByRecipeId = new Map<string, BoolVariable>()
  const yByCustomerRecipe = new Map<string, BoolVariable>()
  const operationByEdgeKey = new Map<string, IntVariable>()
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
    (needsRecipeSpecificAssignments || needsJarStructure)
  ) {
    throw new Error(
      'Grouped assignments require recipe-insensitive stage feasibility',
    )
  }

  const assignmentGroups = options.aggregateEquivalentAssignments
    ? (() => {
        const groups = new Map<
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
          const group = groups.get(key)
          if (group) group.recipes.push(recipe)
          else {
            groups.set(key, {
              key,
              recipes: [recipe],
              eligibleCustomerIds,
            })
          }
        }
        return [...groups.values()]
      })()
    : null

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
    recipeUpperBoundById.set(
      recipe.candidate.id,
      recipeUpperBound,
    )

    if (options.fixedRecipeUnits) {
      model.addConstraint(
        x.eq(
          options.fixedRecipeUnits.get(recipe.candidate.id) ?? 0,
        ),
        `fixed_recipe_units_${recipeIndex}`,
      )
    }

    if (needsRecipeUsageStructure) {
      const z = model.boolVar(`z_${recipeIndex}`)
      zByRecipeId.set(recipe.candidate.id, z)

      model.addConstraint(
        x.minus(z.times(Math.max(1, recipeUpperBound))).leq(0),
        `usage_upper_${recipeIndex}`,
      )
      model.addConstraint(
        z.minus(x).leq(0),
        `usage_lower_${recipeIndex}`,
      )
    }
  })

  if (assignmentGroups) {
    domain.serviceableCustomerIds.forEach(
      (customerId, customerIndex) => {
        const assignmentVars: BoolVariable[] = []

        assignmentGroups.forEach((group, groupIndex) => {
          if (!group.eligibleCustomerIds.includes(customerId)) return

          const y = options.relaxAssignmentVariables
            ? model.numVar(
                0,
                1,
                `y_${customerIndex}_${groupIndex}`,
              )
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
      },
    )

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
  } else {
    domain.serviceableCustomerIds.forEach(
      (customerId, customerIndex) => {
        const assignmentVars: BoolVariable[] = []

        domain.recipes.forEach((recipe, recipeIndex) => {
          if (!recipe.eligibleCustomerIds.includes(customerId)) {
            return
          }

          const y = model.boolVar(
            `y_${customerIndex}_${recipeIndex}`,
          )
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
      },
    )

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
  }

  if (needsProductionOperations) {
    const quantityTermsByEdgeKey = new Map<
      string,
      ReturnType<IntVariable['times']>[]
    >()
    const quantityUpperBoundByEdgeKey = new Map<string, number>()

    for (const recipe of domain.recipes) {
      const x = xByRecipeId.get(recipe.candidate.id)
      if (!x) continue

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (
          options.machineOperationKinds &&
          !options.machineOperationKinds.has(edge.kind)
        ) {
          continue
        }
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }

      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            multiplicity *
              (recipeUpperBoundById.get(recipe.candidate.id) ??
                maxJuiceUnitsPerRecipe),
        )
      }
    }

    ;[...quantityTermsByEdgeKey.entries()].forEach(
      ([edgeKey, quantityTerms], edgeIndex) => {
        const operationUpperBound =
          options.tightenOperationBoundsFromRecipeBounds
            ? Math.min(
                maxTotalJuiceUnits,
                Math.ceil(
                  (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
                    PROCESSING_STACK_CAPACITY,
                ),
              )
            : maxTotalJuiceUnits
        const operationCount = model.intVar(
          0,
          operationUpperBound,
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
      },
    )
  }

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

  const productionUnitsExpression =
    needsAnyObjective('productionUnits') ||
    typeof options.productionUnitsLowerBound === 'number'
      ? sum(
          ...domain.recipes.flatMap((recipe) => {
            const x = xByRecipeId.get(recipe.candidate.id)
            return x ? [x] : []
          }),
        )
      : undefined

  if (
    productionUnitsExpression &&
    typeof options.productionUnitsLowerBound === 'number'
  ) {
    model.addConstraint(
      productionUnitsExpression
        .times(-1)
        .leq(-Math.max(0, Math.floor(options.productionUnitsLowerBound))),
      'production_units_lower_bound',
    )
  }

  const kindExpression = needsAnyObjective('kinds')
    ? sum(
        ...domain.recipes.flatMap((recipe) => {
          const z = zByRecipeId.get(recipe.candidate.id)
          return z ? [z] : []
        }),
      )
    : undefined

  const machineOperationsExpression = needsAnyObjective('machineOperations')
    ? sum(...operationByEdgeKey.values())
    : undefined

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

  let jarSwitches: IntVariable | undefined

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

  return {
    model,
    xByRecipeId,
    yByCustomerRecipe,
    operationByEdgeKey,
  }
}

function selectedRecipeUnits(
  domain: BatchOptimizationModel,
  built: ReturnType<typeof buildHighsStage>,
  solution: Awaited<ReturnType<Model['solve']>>,
): RecipeUnitSelection[] {
  return domain.recipes.flatMap((recipe) => {
    const variable = built.xByRecipeId.get(recipe.candidate.id)
    if (!variable) return []
    const units = Math.round(
      requiredFiniteNumber(
        solution.getValue(variable),
        `production units ${recipe.candidate.id}`,
      ),
    )
    return units > 0
      ? [{ recipeId: recipe.candidate.id, units }]
      : []
  })
}

function verifiedAssignmentCount(
  domain: BatchOptimizationModel,
  built: ReturnType<typeof buildHighsStage>,
  solution: Awaited<ReturnType<Model['solve']>>,
): number {
  return domain.serviceableCustomerIds.filter((customerId) =>
    domain.recipes.some((recipe) => {
      const variable = built.yByCustomerRecipe.get(
        `${customerId}\u001f${recipe.candidate.id}`,
      )
      return variable
        ? requiredFiniteNumber(
            solution.getValue(variable),
            `assignment ${customerId}/${recipe.candidate.id}`,
          ) > 0.5
        : false
    }),
  ).length
}

export interface MachineOperationCertificateSummary {
  optimum: number
  lowerBounds: {
    throughSeasoning: number
    blending: number
    finalizing: number
  }
  witnessRecipeUnits: RecipeUnitSelection[]
  witnessRepairSteps: number
  verifiedAssignmentCount: number
}

interface InternalMachineOperationCertificate
  extends MachineOperationCertificateSummary {
  built: ReturnType<typeof buildHighsStage>
  solution: Awaited<ReturnType<Model['solve']>>
}

async function tryMachineOperationCertificate(
  domain: BatchOptimizationModel,
  fixedMinimumCost: number,
): Promise<InternalMachineOperationCertificate | null> {
  const fixes: ObjectiveFix[] = [
    {
      objective: 'cost',
      value: fixedMinimumCost,
    },
  ]
  const partitions: Array<{
    key: keyof MachineOperationCertificateSummary['lowerBounds']
    kinds: ProductionStepKind[]
  }> = [
    {
      key: 'throughSeasoning',
      kinds: ['juicing', 'seasoning'],
    },
    {
      key: 'blending',
      kinds: ['blending'],
    },
    {
      key: 'finalizing',
      kinds: ['finalizing'],
    },
  ]
  const lowerBounds = {
    throughSeasoning: 0,
    blending: 0,
    finalizing: 0,
  }
  const witnessCandidates: RecipeUnitSelection[][] = []

  for (const partition of partitions) {
    const built = buildHighsStage(
      domain,
      'machineOperations',
      fixes,
      {
        relaxAssignmentVariables: true,
        aggregateEquivalentAssignments: true,
        tightenRecipeBoundsFromMinimumCostFix: true,
        tightenOperationBoundsFromRecipeBounds: true,
        machineOperationKinds: new Set(partition.kinds),
      },
    )
    const solution = await built.model.solve()
    if (solution.status !== 'optimal') return null

    lowerBounds[partition.key] = Math.round(
      requiredFiniteNumber(
        solution.objective,
        `${partition.key} lower-bound objective`,
      ),
    )
    witnessCandidates.push(
      selectedRecipeUnits(domain, built, solution),
    )
  }

  const lowerBound =
    lowerBounds.throughSeasoning +
    lowerBounds.blending +
    lowerBounds.finalizing

  for (const candidate of witnessCandidates) {
    const repaired = repairMachineOperationWitness(
      domain,
      candidate,
      fixedMinimumCost,
      lowerBound,
    )
    if (repaired.breakdown.total !== lowerBound) continue

    const fixedRecipeUnits = new Map(
      repaired.selections.map((selection) => [
        selection.recipeId,
        selection.units,
      ]),
    )
    const built = buildHighsStage(
      domain,
      'machineOperations',
      fixes,
      {
        fixedRecipeUnits,
      },
    )
    const solution = await built.model.solve()
    if (solution.status !== 'optimal') continue

    const verifiedObjective = Math.round(
      requiredFiniteNumber(
        solution.objective,
        'fixed-x machine objective',
      ),
    )
    const assignmentCount = verifiedAssignmentCount(
      domain,
      built,
      solution,
    )
    if (
      verifiedObjective !== lowerBound ||
      assignmentCount !== domain.serviceableCustomerIds.length
    ) {
      continue
    }

    return {
      optimum: lowerBound,
      lowerBounds,
      witnessRecipeUnits: repaired.selections,
      witnessRepairSteps: repaired.steps.length,
      verifiedAssignmentCount: assignmentCount,
      built,
      solution,
    }
  }

  return null
}

export async function solveMachineOperationCertificateForCostFix(
  domain: BatchOptimizationModel,
  fixedMinimumCost: number,
): Promise<MachineOperationCertificateSummary | null> {
  const certificate = await tryMachineOperationCertificate(
    domain,
    fixedMinimumCost,
  )
  if (!certificate) return null

  return {
    optimum: certificate.optimum,
    lowerBounds: certificate.lowerBounds,
    witnessRecipeUnits: certificate.witnessRecipeUnits,
    witnessRepairSteps: certificate.witnessRepairSteps,
    verifiedAssignmentCount: certificate.verifiedAssignmentCount,
  }
}

export interface JarSwitchCertificateSummary {
  optimum: number
  productionUnits: number
  extraProductionUnitCostLowerBound: number
  finalizingOperations: number
  distinctRecipeKindLowerBound: number
  jarLowerBound: number
  jarUpperBound: number
  witnessRecipeUnits: RecipeUnitSelection[]
  verifiedAssignmentCount: number
}

interface InternalJarSwitchCertificate
  extends JarSwitchCertificateSummary {
  built: ReturnType<typeof buildHighsStage>
  solution: Awaited<ReturnType<Model['solve']>>
}

async function tryJarSwitchCertificate(
  domain: BatchOptimizationModel,
  fixedMinimumCost: number,
  machineCertificate: MachineOperationCertificateSummary,
): Promise<InternalJarSwitchCertificate | null> {
  const initialJars = normalizedInitialCarriedJuiceJars(
    domain.request,
  )
  if (
    initialJars.length === 0 ||
    initialJars.some((jar) => jar.recipeId && jar.servings > 0)
  ) {
    return null
  }

  const maxJarTypeSwitches =
    domain.request.constraints?.maxJarTypeSwitches
  if (
    typeof maxJarTypeSwitches === 'number' &&
    Number.isFinite(maxJarTypeSwitches)
  ) {
    return null
  }

  const productionUnits = Math.ceil(
    domain.serviceableCustomerIds.length / 2,
  )
  const extraUnitProbe = buildHighsStage(
    domain,
    'cost',
    [],
    {
      relaxAssignmentVariables: true,
      aggregateEquivalentAssignments: true,
      productionUnitsLowerBound: productionUnits + 1,
    },
  )
  const extraUnitSolution = await extraUnitProbe.model.solve()
  if (extraUnitSolution.status !== 'optimal') return null

  const extraProductionUnitCostLowerBound = Math.round(
    requiredFiniteNumber(
      extraUnitSolution.objective,
      'extra-production-unit cost lower bound',
    ),
  )
  if (extraProductionUnitCostLowerBound <= fixedMinimumCost) {
    return null
  }

  if (!finalizingEdgesAreRecipeIdentityUnique(domain)) {
    return null
  }

  const finalizingOperations =
    machineCertificate.lowerBounds.finalizing
  const distinctRecipeKindLowerBound =
    minimumRecipeKindsFromFinalizingBound(
      productionUnits,
      finalizingOperations,
    )
  if (distinctRecipeKindLowerBound <= 0) return null

  const witnessRecipeUnits =
    machineCertificate.witnessRecipeUnits.filter(
      (selection) => selection.units > 0,
    )
  const witnessProductionUnits = witnessRecipeUnits.reduce(
    (total, selection) => total + Math.round(selection.units),
    0,
  )
  if (witnessProductionUnits !== productionUnits) return null
  if (
    witnessRecipeUnits.length !== distinctRecipeKindLowerBound
  ) {
    return null
  }

  const witnessRecipeIds = witnessRecipeUnits.map(
    (selection) => selection.recipeId,
  )
  const jarUpperBound = minimumJarTypeSwitchesForRecipeIds(
    domain.request,
    witnessRecipeIds,
  )
  const jarLowerBound = minimumJarTypeSwitchesForRecipeIds(
    domain.request,
    Array.from(
      { length: distinctRecipeKindLowerBound },
      (_, index) => `__jar_certificate_kind_${index}`,
    ),
  )
  if (jarLowerBound !== jarUpperBound) return null

  const fixedRecipeUnits = new Map(
    witnessRecipeUnits.map((selection) => [
      selection.recipeId,
      Math.round(selection.units),
    ]),
  )
  const fixes: ObjectiveFix[] = [
    {
      objective: 'cost',
      value: fixedMinimumCost,
    },
    {
      objective: 'machineOperations',
      value: machineCertificate.optimum,
    },
  ]
  const built = buildHighsStage(
    domain,
    'jarSwitches',
    fixes,
    {
      fixedRecipeUnits,
    },
  )
  const solution = await built.model.solve()
  if (solution.status !== 'optimal') return null

  const verifiedObjective = Math.round(
    requiredFiniteNumber(
      solution.objective,
      'fixed-x jar-switch objective',
    ),
  )
  const assignmentCount = verifiedAssignmentCount(
    domain,
    built,
    solution,
  )
  if (
    verifiedObjective !== jarLowerBound ||
    assignmentCount !== domain.serviceableCustomerIds.length
  ) {
    return null
  }

  return {
    optimum: jarLowerBound,
    productionUnits,
    extraProductionUnitCostLowerBound,
    finalizingOperations,
    distinctRecipeKindLowerBound,
    jarLowerBound,
    jarUpperBound,
    witnessRecipeUnits,
    verifiedAssignmentCount: assignmentCount,
    built,
    solution,
  }
}

export async function solveJarSwitchCertificateForCostAndMachineFix(
  domain: BatchOptimizationModel,
  fixedMinimumCost: number,
  machineCertificate: MachineOperationCertificateSummary,
): Promise<JarSwitchCertificateSummary | null> {
  const certificate = await tryJarSwitchCertificate(
    domain,
    fixedMinimumCost,
    machineCertificate,
  )
  if (!certificate) return null

  return {
    optimum: certificate.optimum,
    productionUnits: certificate.productionUnits,
    extraProductionUnitCostLowerBound:
      certificate.extraProductionUnitCostLowerBound,
    finalizingOperations: certificate.finalizingOperations,
    distinctRecipeKindLowerBound:
      certificate.distinctRecipeKindLowerBound,
    jarLowerBound: certificate.jarLowerBound,
    jarUpperBound: certificate.jarUpperBound,
    witnessRecipeUnits: certificate.witnessRecipeUnits,
    verifiedAssignmentCount: certificate.verifiedAssignmentCount,
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
    let currentDomain = domain
    let minimumCostCertificateApplied = false
    let machineCertificate:
      | MachineOperationCertificateSummary
      | null = null
    let final:
      | {
          domain: BatchOptimizationModel
          built: ReturnType<typeof buildHighsStage>
          solution: Awaited<ReturnType<Model['solve']>>
        }
      | undefined

    for (
      let objectiveIndex = 0;
      objectiveIndex < objectives.length;
      objectiveIndex += 1
    ) {
      const objectiveKey = objectives[objectiveIndex]
      let stageDomain = currentDomain
      let continuationDomain = currentDomain
      let usingMinimumCostCertificate = false

      if (objectiveIndex === 0 && objectiveKey === 'cost') {
        const certificate = prepareMinimumCostStageCertificate(domain)
        if (
          certificate &&
          certificate.representativeRecipeCount <
            certificate.originalRecipeCount
        ) {
          stageDomain = certificate.stageDomain
          continuationDomain = certificate.continuationDomain
          usingMinimumCostCertificate = true
        }
      }

      if (
        objectiveKey === 'machineOperations' &&
        minimumCostCertificateApplied &&
        fixes.length === 1 &&
        fixes[0].objective === 'cost' &&
        currentDomain.recipes.length >= PRODUCTION_CERTIFICATE_RECIPE_COUNT_GATE
      ) {
        const certificate = await tryMachineOperationCertificate(
          currentDomain,
          fixes[0].value,
        )
        if (certificate) {
          machineCertificate = certificate
          final = {
            domain: currentDomain,
            built: certificate.built,
            solution: certificate.solution,
          }
          fixes.push({
            objective: objectiveKey,
            value: certificate.optimum,
          })
          currentDomain = continuationDomain
          continue
        }
      }

      if (
        objectiveKey === 'jarSwitches' &&
        minimumCostCertificateApplied &&
        machineCertificate &&
        fixes.length === 2 &&
        fixes[0].objective === 'cost' &&
        fixes[1].objective === 'machineOperations' &&
        currentDomain.recipes.length >= PRODUCTION_CERTIFICATE_RECIPE_COUNT_GATE
      ) {
        const certificate = await tryJarSwitchCertificate(
          currentDomain,
          fixes[0].value,
          machineCertificate,
        )
        if (certificate) {
          final = {
            domain: currentDomain,
            built: certificate.built,
            solution: certificate.solution,
          }
          fixes.push({
            objective: objectiveKey,
            value: certificate.optimum,
          })
          currentDomain = continuationDomain

          const remainingObjectives = objectives.slice(
            objectiveIndex + 1,
          )
          if (
            remainingObjectives.every(
              (remainingObjective) =>
                remainingObjective === 'productionUnits' ||
                remainingObjective === 'kinds',
            )
          ) {
            break
          }
          continue
        }
      }

      let built = buildHighsStage(stageDomain, objectiveKey, fixes)
      let solution = await built.model.solve()

      if (
        usingMinimumCostCertificate &&
        solution.status !== 'optimal'
      ) {
        stageDomain = domain
        continuationDomain = domain
        usingMinimumCostCertificate = false
        built = buildHighsStage(domain, objectiveKey, fixes)
        solution = await built.model.solve()
      }

      if (solution.status !== 'optimal') {
        throw new PlanningUserError(
          'optimizer-no-solution',
          { solverStatus: solution.status },
          `HiGHS optimizer ended with status: ${solution.status}`,
        )
      }

      if (objectiveIndex === 0 && objectiveKey === 'cost') {
        minimumCostCertificateApplied = usingMinimumCostCertificate
      }

      const optimum = Math.round(
        requiredFiniteNumber(solution.objective, `${objectiveKey} objective`),
      )
      final = {
        domain: stageDomain,
        built,
        solution,
      }
      fixes.push({
        objective: objectiveKey,
        value: optimum,
      })
      currentDomain = continuationDomain
    }

    if (!final) {
      throw new Error('HiGHS optimizer did not run')
    }

    const finalStage = final
    const finalDomain = finalStage.domain
    const assignments = finalDomain.serviceableCustomerIds.map(
      (customerId) => {
        const recipe = finalDomain.recipes.find((entry) => {
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
    for (const recipe of finalDomain.recipes) {
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
    const totalIngredientCost = finalDomain.recipes.reduce(
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
