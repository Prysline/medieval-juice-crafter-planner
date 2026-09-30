import { HiGHS, Model, sum } from '@bubblyworld/highs-ts'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { juiceStateIdentity } from './juiceStateIdentity'
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
  | 'jarFillOperations'
  | 'jarSwitches'
  | 'negativeEmptiedInitialJars'
  | 'negativeAssignedCustomers'
  | 'inventoryShortfall'

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
  return 'jarFillOperations'
}

function objectiveOrder(
  priorities: OptimizationCriterion[],
  includeInitialJarReleaseTieBreak: boolean,
  maximizeAssignedCustomers: boolean,
): ObjectiveKey[] {
  const explicit = priorities.map(criterionKey)
  const fallback: ObjectiveKey[] = [
    'cost',
    ...(includeInitialJarReleaseTieBreak
      ? (['negativeEmptiedInitialJars'] as const)
      : []),
    'productionUnits',
    'machineOperations',
    'kinds',
  ]
  return [
    ...new Set([
      ...(maximizeAssignedCustomers
        ? (['negativeAssignedCustomers'] as const)
        : []),
      ...explicit,
      ...fallback,
    ]),
  ]
}

interface HighsStageOptions {
  relaxAssignmentVariables?: boolean
  aggregateEquivalentAssignments?: boolean
  aggregateEquivalentMaximumCostAssignments?: boolean
  aggregateEquivalentMaximumCostProductionUnits?: boolean
  tightenRecipeBoundsFromMinimumCostFix?: boolean
  tightenOperationBoundsFromRecipeBounds?: boolean
  machineOperationKinds?: Set<ProductionStepKind>
  fixedRecipeUnits?: Map<string, number>
  productionUnitsLowerBound?: number
  allowUnassignedCustomers?: boolean
}

export function minimumWasteEquivalentAssignmentGroupingIsSafe(
  domain: BatchOptimizationModel,
): boolean {
  if (domain.request.materialSourceMode === 'inventory-only') {
    return false
  }
  if (
    domain.recipes.some(
      (recipe) => recipe.maxProductionUnits !== undefined,
    )
  ) {
    return false
  }

  const initialJars = normalizedInitialCarriedJuiceJars(
    domain.request,
  )
  const emptyJarCount = initialJars.filter(
    (jar) => !jar.recipeId || jar.servings <= 0,
  ).length
  if (emptyJarCount === 0) return false

  const maxJarTypeSwitches =
    domain.request.constraints?.maxJarTypeSwitches
  if (
    typeof maxJarTypeSwitches === 'number' &&
    Number.isFinite(maxJarTypeSwitches)
  ) {
    return false
  }

  return true
}

function maximumIngredientCostGroupedProductionIsSafe(
  domain: BatchOptimizationModel,
): boolean {
  if (!minimumWasteEquivalentAssignmentGroupingIsSafe(domain)) {
    return false
  }

  const maxJarFillOperations =
    domain.request.constraints?.maxJarFillOperations
  return !(
    typeof maxJarFillOperations === 'number' &&
    Number.isFinite(maxJarFillOperations)
  )
}

function initialFinishedJarEmptyingThresholds(
  jars: readonly { recipeId: string | null; servings: number }[],
): Map<string, number[]> {
  const servingsByRecipeId = new Map<string, number[]>()

  for (const jar of jars) {
    if (!jar.recipeId || jar.servings <= 0) continue
    const current = servingsByRecipeId.get(jar.recipeId) ?? []
    current.push(jar.servings)
    servingsByRecipeId.set(jar.recipeId, current)
  }

  const thresholdsByRecipeId = new Map<string, number[]>()
  for (const [recipeId, servings] of servingsByRecipeId) {
    let cumulative = 0
    const thresholds = [...servings]
      .sort((a, b) => a - b)
      .map((value) => {
        cumulative += value
        return cumulative
      })
    thresholdsByRecipeId.set(recipeId, thresholds)
  }

  return thresholdsByRecipeId
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
  const groupedProductionUnitsByAssignmentGroupKey =
    new Map<string, IntVariable>()
  const recipeUpperBoundById = new Map<string, number>()
  const zByRecipeId = new Map<string, BoolVariable>()
  const yByCustomerRecipe = new Map<string, BoolVariable>()
  const assignedIngredientCostByAssignmentKey = new Map<string, number>()
  const operationByEdgeKey = new Map<string, IntVariable>()
  const operationKindByEdgeKey = new Map<string, ProductionStepKind>()
  const materialFlowByEdgeKey = new Map<string, IntVariable>()
  const inventoryShortfallByIngredientId = new Map<string, IntVariable>()
  const neededObjectiveKeys = new Set<ObjectiveKey>([
    objective,
    ...fixes.map((fix) => fix.objective),
  ])
  const needsAnyObjective = (...keys: ObjectiveKey[]) =>
    keys.some((key) => neededObjectiveKeys.has(key))

  const initialJars = normalizedInitialCarriedJuiceJars(
    domain.request,
  )
  const initialJarEmptyingThresholds =
    initialFinishedJarEmptyingThresholds(initialJars)
  const emptyJarCount = initialJars.filter(
    (jar) => !jar.recipeId || jar.servings <= 0,
  ).length
  const maxJarTypeSwitches =
    domain.request.constraints?.maxJarTypeSwitches
  const maxJarFillOperations =
    domain.request.constraints?.maxJarFillOperations
  const hasJarHardConstraint =
    emptyJarCount === 0 ||
    (
      typeof maxJarTypeSwitches === 'number' &&
      Number.isFinite(maxJarTypeSwitches)
    )
  const hasJarFillHardConstraint =
    typeof maxJarFillOperations === 'number' &&
    Number.isFinite(maxJarFillOperations)
  const needsJarStructure =
    needsAnyObjective('jarSwitches') || hasJarHardConstraint
  const needsRecipeUsageStructure =
    needsAnyObjective('kinds') || needsJarStructure
  const needsProductionOperations =
    needsAnyObjective('machineOperations', 'jarFillOperations') ||
    hasJarFillHardConstraint
  const needsRecipeSpecificAssignments = needsAnyObjective(
    'negativeAssignedIngredientCost',
    'negativeKnownRevenue',
    'negativeKnownGrossProfit',
    'negativeEmptiedInitialJars',
  )

  if (
    options.aggregateEquivalentAssignments &&
    options.aggregateEquivalentMaximumCostAssignments
  ) {
    throw new Error('Only one assignment grouping mode may be active')
  }

  if (
    options.aggregateEquivalentMaximumCostProductionUnits &&
    !options.aggregateEquivalentMaximumCostAssignments
  ) {
    throw new Error(
      'Maximum-cost production grouping requires maximum-cost assignment grouping',
    )
  }

  if (
    options.aggregateEquivalentMaximumCostProductionUnits &&
    (
      domain.request.materialSourceMode === 'inventory-only' ||
      needsProductionOperations ||
      needsRecipeUsageStructure ||
      options.fixedRecipeUnits
    )
  ) {
    throw new Error(
      'Maximum-cost production grouping requires recipe-insensitive production feasibility',
    )
  }

  if (
    options.aggregateEquivalentAssignments &&
    (needsRecipeSpecificAssignments || needsJarStructure)
  ) {
    throw new Error(
      'Grouped assignments require recipe-insensitive stage feasibility',
    )
  }

  if (
    options.aggregateEquivalentMaximumCostAssignments &&
    (
      needsAnyObjective(
        'negativeKnownRevenue',
        'negativeKnownGrossProfit',
        'negativeEmptiedInitialJars',
      ) ||
      needsJarStructure
    )
  ) {
    throw new Error(
      'Maximum-cost grouping requires assignment equivalence for every active fix',
    )
  }

  // A maximum-cost assignment group is exact only when every member
  // recipe has both the same service set and the same assignment-cost
  // coefficient. Customer identities can then move freely between recipes
  // inside the group without changing eligibility or the Stage 2 objective.
  // Real recipe identities are restored by the next lexicographic stage.
  const shouldGroupAssignments =
    options.aggregateEquivalentAssignments ||
    options.aggregateEquivalentMaximumCostAssignments
  const assignmentGroups = shouldGroupAssignments
    ? (() => {
        const groups = new Map<
          string,
          {
            key: string
            recipes: typeof domain.recipes
            eligibleCustomerIds: string[]
            ingredientCost?: number
          }
        >()
        for (const recipe of domain.recipes) {
          const eligibleCustomerIds = [
            ...recipe.eligibleCustomerIds,
          ].sort()
          const serviceKey = eligibleCustomerIds.join('\u001e')
          const ingredientCost =
            options.aggregateEquivalentMaximumCostAssignments
              ? recipe.juiceUnitIngredientCost
              : undefined
          const key =
            ingredientCost === undefined
              ? serviceKey
              : `${serviceKey}\u001d${ingredientCost}`
          const group = groups.get(key)
          if (group) group.recipes.push(recipe)
          else {
            groups.set(key, {
              key,
              recipes: [recipe],
              eligibleCustomerIds,
              ...(ingredientCost === undefined
                ? {}
                : { ingredientCost }),
            })
          }
        }
        return [...groups.values()]
      })()
    : null

  if (options.aggregateEquivalentMaximumCostProductionUnits) {
    // With recipe-specific production constraints disabled, X_group is
    // exactly the sum of the original integer recipe x variables in this
    // equivalence class. This mode is only entered after Stage 1 has fixed
    // the global minimum productionUnits. Therefore producing more units in
    // a group than all of its eligible customers could consume would
    // contradict that minimum; the customer-capacity upper bound is exact.
    // Later stages restore individual x.
    if (!assignmentGroups) {
      throw new Error(
        'Maximum-cost production grouping requires assignment groups',
      )
    }

    assignmentGroups.forEach((group, groupIndex) => {
      groupedProductionUnitsByAssignmentGroupKey.set(
        group.key,
        model.intVar(
          0,
          Math.max(
            0,
            Math.ceil(group.eligibleCustomerIds.length / 2),
          ),
          `x_group_${groupIndex}`,
        ),
      )
    })
  } else {
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
      const computedRecipeUpperBound =
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
      const recipeUpperBound = Math.min(
        computedRecipeUpperBound,
        recipe.maxProductionUnits === undefined
          ? computedRecipeUpperBound
          : Math.max(0, Math.floor(recipe.maxProductionUnits)),
      )
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
        zByRecipeId.set(
          recipe.candidate.id,
          model.boolVar(`z_${recipeIndex}`),
        )
      }
    })
  }

  if (domain.request.materialSourceMode === 'inventory-only') {
    const rawInventory =
      domain.request.materialInventory?.ingredientUnits ?? {}
    const intermediateInventory =
      domain.request.materialInventory?.intermediateJuiceUnits ?? {}
    const edgeByKey = new Map<
      string,
      {
        kind: ProductionStepKind
        fromIngredientIds: string[]
        secondaryFromIngredientIds?: string[]
        toIngredientIds: string[]
        addedIngredientId?: string
      }
    >()
    const producerEdgeKeyByNode = new Map<string, string>()
    const maxRecipeIngredientCount = Math.max(
      1,
      ...domain.recipes.map(
        (recipe) => recipe.productionPath.ingredientIds.length,
      ),
    )
    const materialFlowUpperBound =
      maxTotalJuiceUnits * maxRecipeIngredientCount

    for (const recipe of domain.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'finalizing') continue
        if (!edgeByKey.has(edge.key)) {
          edgeByKey.set(edge.key, {
            kind: edge.kind,
            fromIngredientIds: [...edge.fromIngredientIds],
            secondaryFromIngredientIds:
              edge.secondaryFromIngredientIds
                ? [...edge.secondaryFromIngredientIds]
                : undefined,
            toIngredientIds: [...edge.toIngredientIds],
            addedIngredientId: edge.addedIngredientId,
          })
        }
        const nodeIdentity = juiceStateIdentity(edge.toIngredientIds)
        const existingProducer = producerEdgeKeyByNode.get(nodeIdentity)
        if (existingProducer && existingProducer !== edge.key) {
          throw new Error(
            `Multiple optimizer production edges produce intermediate node ${nodeIdentity}`,
          )
        }
        producerEdgeKeyByNode.set(nodeIdentity, edge.key)
      }
    }

    let materialEdgeIndex = 0
    for (const edgeKey of edgeByKey.keys()) {
      materialFlowByEdgeKey.set(
        edgeKey,
        model.intVar(
          0,
          Math.max(1, materialFlowUpperBound),
          `material_flow_${materialEdgeIndex}`,
        ),
      )
      materialEdgeIndex += 1
    }

    const demandTermsByNode = new Map<
      string,
      ReturnType<IntVariable['times']>[]
    >()
    const addNodeDemand = (
      ingredientIds: string[],
      term: ReturnType<IntVariable['times']>,
    ) => {
      const identity = juiceStateIdentity(ingredientIds)
      const current = demandTermsByNode.get(identity)
      if (current) current.push(term)
      else demandTermsByNode.set(identity, [term])
    }

    for (const recipe of domain.recipes) {
      const x = xByRecipeId.get(recipe.candidate.id)
      if (!x) continue
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind !== 'finalizing') continue
        addNodeDemand(edge.fromIngredientIds, x.times(1))
      }
    }

    for (const [edgeKey, edge] of edgeByKey) {
      const flow = materialFlowByEdgeKey.get(edgeKey)
      if (!flow) continue

      if (edge.kind === 'seasoning' || edge.kind === 'blending') {
        addNodeDemand(edge.fromIngredientIds, flow.times(1))
      }
      if (
        edge.kind === 'blending' &&
        edge.secondaryFromIngredientIds &&
        edge.secondaryFromIngredientIds.length > 0
      ) {
        addNodeDemand(
          edge.secondaryFromIngredientIds,
          flow.times(1),
        )
      }
    }

    let materialNodeIndex = 0
    for (const [nodeIdentity, producerEdgeKey] of producerEdgeKeyByNode) {
      const flow = materialFlowByEdgeKey.get(producerEdgeKey)
      if (!flow) continue
      const demandTerms = demandTermsByNode.get(nodeIdentity) ?? []
      const stock = Math.max(
        0,
        Math.floor(intermediateInventory[nodeIdentity] ?? 0),
      )
      const demand = sum(...demandTerms)

      model.addConstraint(
        demand.minus(flow).leq(stock),
        `material_stock_${materialNodeIndex}`,
      )
      model.addConstraint(
        flow.minus(demand).leq(0),
        `material_no_overproduction_${materialNodeIndex}`,
      )
      materialNodeIndex += 1
    }

    const rawFlowTermsByIngredientId = new Map<
      string,
      ReturnType<IntVariable['times']>[]
    >()
    for (const [edgeKey, edge] of edgeByKey) {
      if (!edge.addedIngredientId) continue
      const flow = materialFlowByEdgeKey.get(edgeKey)
      if (!flow) continue
      const current =
        rawFlowTermsByIngredientId.get(edge.addedIngredientId)
      const term = flow.times(1)
      if (current) current.push(term)
      else {
        rawFlowTermsByIngredientId.set(
          edge.addedIngredientId,
          [term],
        )
      }
    }

    let rawIngredientIndex = 0
    for (const [ingredientId, terms] of rawFlowTermsByIngredientId) {
      const available = Math.max(
        0,
        Math.floor(rawInventory[ingredientId] ?? 0),
      )
      const usage = sum(...terms)

      if (objective === 'inventoryShortfall') {
        const shortfall = model.intVar(
          0,
          Math.max(1, materialFlowUpperBound),
          `inventory_shortfall_${rawIngredientIndex}`,
        )
        inventoryShortfallByIngredientId.set(
          ingredientId,
          shortfall,
        )
        model.addConstraint(
          usage.minus(shortfall).leq(available),
          `raw_inventory_${rawIngredientIndex}`,
        )
      } else {
        model.addConstraint(
          usage.leq(available),
          `raw_inventory_${rawIngredientIndex}`,
        )
      }
      rawIngredientIndex += 1
    }

    if (
      objective === 'inventoryShortfall' &&
      inventoryShortfallByIngredientId.size === 0
    ) {
      inventoryShortfallByIngredientId.set(
        '__none__',
        model.intVar(0, 0, 'inventory_shortfall_zero'),
      )
    }
  }

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
          const assignmentKey =
            `${customerId}\u001f${group.key}`
          yByCustomerRecipe.set(assignmentKey, y)
          if (
            options.aggregateEquivalentMaximumCostAssignments &&
            group.ingredientCost !== undefined
          ) {
            assignedIngredientCostByAssignmentKey.set(
              assignmentKey,
              group.ingredientCost,
            )
          }
          assignmentVars.push(y)
        })

        const assignedCustomer = sum(...assignmentVars)
        model.addConstraint(
          options.allowUnassignedCustomers
            ? assignedCustomer.leq(1)
            : assignedCustomer.eq(1),
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
      const groupedProductionUnits =
        groupedProductionUnitsByAssignmentGroupKey.get(group.key)
      const capacityTerms = groupedProductionUnits
        ? [groupedProductionUnits.times(2)]
        : group.recipes.flatMap((recipe) => {
            const x = xByRecipeId.get(recipe.candidate.id)
            return x ? [x.times(2)] : []
          })
      const finishedServings = group.recipes.reduce(
        (sum, recipe) => sum + (recipe.initialFinishedServings ?? 0),
        0,
      )

      model.addConstraint(
        sum(...assignmentVars)
          .minus(sum(...capacityTerms))
          .leq(finishedServings),
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
          const assignmentKey =
            `${customerId}\u001f${recipe.candidate.id}`
          yByCustomerRecipe.set(assignmentKey, y)
          if (needsAnyObjective('negativeAssignedIngredientCost')) {
            assignedIngredientCostByAssignmentKey.set(
              assignmentKey,
              recipe.juiceUnitIngredientCost,
            )
          }
          assignmentVars.push(y)
        })

        const assignedCustomer = sum(...assignmentVars)
        model.addConstraint(
          options.allowUnassignedCustomers
            ? assignedCustomer.leq(1)
            : assignedCustomer.eq(1),
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

      const assignedServings = sum(...assignmentVars)
      model.addConstraint(
        assignedServings
          .minus(x.times(2))
          .leq((recipe.initialFinishedServings ?? 0)),
        `capacity_${recipeIndex}`,
      )

      const z = zByRecipeId.get(recipe.candidate.id)
      if (z) {
        const assignmentUpperBound = Math.max(
          1,
          recipe.eligibleCustomerIds.length,
        )
        model.addConstraint(
          assignedServings
            .minus(z.times(assignmentUpperBound))
            .leq(0),
          `usage_upper_${recipeIndex}`,
        )
        model.addConstraint(
          z.minus(assignedServings).leq(0),
          `usage_lower_${recipeIndex}`,
        )
      }
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
        const existingKind = operationKindByEdgeKey.get(edge.key)
        if (existingKind && existingKind !== edge.kind) {
          throw new Error(
            `Production edge ${edge.key} changed kind from ${existingKind} to ${edge.kind}`,
          )
        }
        operationKindByEdgeKey.set(edge.key, edge.kind)
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
          ...(groupedProductionUnitsByAssignmentGroupKey.size > 0
            ? [...groupedProductionUnitsByAssignmentGroupKey.values()]
            : domain.recipes.flatMap((recipe) => {
                const x = xByRecipeId.get(recipe.candidate.id)
                return x ? [x] : []
              })),
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

  const jarFillOperationsExpression =
    needsAnyObjective('jarFillOperations') || hasJarFillHardConstraint
      ? sum(
          ...[...operationByEdgeKey.entries()].flatMap(
            ([edgeKey, operation]) =>
              operationKindByEdgeKey.get(edgeKey) === 'finalizing'
                ? [operation]
                : [],
          ),
        )
      : undefined

  if (jarFillOperationsExpression && hasJarFillHardConstraint) {
    model.addConstraint(
      jarFillOperationsExpression.leq(
        Math.max(0, Math.floor(maxJarFillOperations!)),
      ),
      'jar_fill_operation_hard_limit',
    )
  }

  const assignedIngredientCostExpression = needsAnyObjective(
    'negativeAssignedIngredientCost',
  )
    ? sum(
        ...[...yByCustomerRecipe.entries()].flatMap(
          ([assignmentKey, y]) => {
            const ingredientCost =
              assignedIngredientCostByAssignmentKey.get(assignmentKey)
            return ingredientCost === undefined
              ? []
              : [y.times(ingredientCost)]
          },
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

  const emptiedInitialJarVars: BoolVariable[] = []
  if (needsAnyObjective('negativeEmptiedInitialJars')) {
    domain.recipes.forEach((recipe, recipeIndex) => {
      const thresholds =
        initialJarEmptyingThresholds.get(recipe.candidate.id) ?? []
      if (thresholds.length === 0) return

      const assignedServings = sum(
        ...domain.serviceableCustomerIds.flatMap((customerId) => {
          const y = yByCustomerRecipe.get(
            `${customerId}\u001f${recipe.candidate.id}`,
          )
          return y ? [y] : []
        }),
      )

      let previous: BoolVariable | undefined
      thresholds.forEach((threshold, thresholdIndex) => {
        const emptied = model.boolVar(
          `initial_jar_emptied_${recipeIndex}_${thresholdIndex}`,
        )
        model.addConstraint(
          emptied.times(threshold).minus(assignedServings).leq(0),
          `initial_jar_empty_threshold_${recipeIndex}_${thresholdIndex}`,
        )
        if (previous) {
          model.addConstraint(
            emptied.minus(previous).leq(0),
            `initial_jar_empty_prefix_${recipeIndex}_${thresholdIndex}`,
          )
        }
        previous = emptied
        emptiedInitialJarVars.push(emptied)
      })
    })
  }

  const negativeEmptiedInitialJarsExpression =
    needsAnyObjective('negativeEmptiedInitialJars')
      ? sum(...emptiedInitialJarVars).times(-1)
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

  const assignedCustomerCountExpression =
    needsAnyObjective('negativeAssignedCustomers')
      ? sum(...yByCustomerRecipe.values())
      : undefined

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
    jarFillOperations: jarFillOperationsExpression,
    jarSwitches,
    negativeEmptiedInitialJars:
      negativeEmptiedInitialJarsExpression,
    negativeAssignedCustomers:
      assignedCustomerCountExpression?.times(-1),
    inventoryShortfall:
      objective === 'inventoryShortfall'
        ? sum(...inventoryShortfallByIngredientId.values())
        : undefined,
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
    groupedProductionUnitsByAssignmentGroupKey,
    operationByEdgeKey,
    inventoryShortfallByIngredientId,
  }
}


export async function profileGroupedMaximumIngredientCostStage(
  domain: BatchOptimizationModel,
  timeLimitSeconds = 20,
): Promise<{
  recipeCount: number
  customerCount: number
  minimumWasteOptimum: number
  assignmentVariableCount: number
  groupedProductionVariableCount: number
  buildMs: number
  serializeMs: number
  parseMs: number
  solveMs: number
  status: string
  objectiveValue: number | null
}> {
  if (
    !minimumWasteEquivalentAssignmentGroupingIsSafe(domain) ||
    !maximumIngredientCostGroupedProductionIsSafe(domain)
  ) {
    throw new Error('Profiling fixture is not safe for grouped maximum-cost Stage 2')
  }

  const wasteBuilt = buildHighsStage(
    domain,
    'productionUnits',
    [],
    { aggregateEquivalentAssignments: true },
  )
  const wasteSolution = await wasteBuilt.model.solve()
  if (wasteSolution.status !== 'optimal') {
    throw new Error(
      `Grouped minimum-waste profiling stage ended with status: ${wasteSolution.status}`,
    )
  }
  const minimumWasteOptimum = Math.round(
    requiredFiniteNumber(
      wasteSolution.objective,
      'grouped minimum-waste profiling objective',
    ),
  )

  const buildStartedAt = performance.now()
  const built = buildHighsStage(
    domain,
    'negativeAssignedIngredientCost',
    [{
      objective: 'productionUnits',
      value: minimumWasteOptimum,
    }],
    {
      aggregateEquivalentMaximumCostAssignments: true,
      aggregateEquivalentMaximumCostProductionUnits: true,
    },
  )
  const buildMs = performance.now() - buildStartedAt

  const serializeStartedAt = performance.now()
  const mps = built.model.print('mps')
  const serializeMs = performance.now() - serializeStartedAt

  const highs = await HiGHS.create()
  let parseMs = 0
  let solveMs = 0
  let status = 'unknown'
  let objectiveValue: number | null = null

  try {
    const parseStartedAt = performance.now()
    await highs.parse(mps, 'mps')
    parseMs = performance.now() - parseStartedAt

    highs.setParam(
      'time_limit',
      Math.max(
        0.1,
        Number.isInteger(timeLimitSeconds)
          ? timeLimitSeconds + 1e-6
          : timeLimitSeconds,
      ),
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
  } finally {
    highs.free()
  }

  return {
    recipeCount: domain.recipes.length,
    customerCount: domain.serviceableCustomerIds.length,
    minimumWasteOptimum,
    assignmentVariableCount: built.yByCustomerRecipe.size,
    groupedProductionVariableCount:
      built.groupedProductionUnitsByAssignmentGroupKey.size,
    buildMs,
    serializeMs,
    parseMs,
    solveMs,
    status,
    objectiveValue,
  }
}

interface StageProfile {
  assignmentVariableCount: number
  groupedProductionVariableCount: number
  recipeProductionVariableCount: number
  buildMs: number
  serializeMs: number
  parseMs: number
  solveMs: number
  status: string
  objectiveValue: number | null
}


export async function profileMaximumIngredientCostContinuationStages(
  domain: BatchOptimizationModel,
  timeLimitSeconds = 10.5,
): Promise<{
  productionUnits: number
  maximumCostOptimum: number
  assignedIngredientCost: number
  slackServings: number
  minimumRecipeCost: number
  costLowerBound: number | null
  witnessProductionCost: number
  costCertificateCloses: boolean
  costGroupedLong: StageProfile
  machineGeneric: StageProfile | null
  machineGrouped: StageProfile | null
}> {
  type BuiltStage = ReturnType<typeof buildHighsStage>
  const profileStage = async (
    build: () => BuiltStage,
    timeLimit: number,
  ): Promise<{ built: BuiltStage; profile: StageProfile }> => {
    const buildStartedAt = performance.now()
    const built = build()
    const buildMs = performance.now() - buildStartedAt

    const serializeStartedAt = performance.now()
    const mps = built.model.print('mps')
    const serializeMs = performance.now() - serializeStartedAt

    const highs = await HiGHS.create()
    let parseMs = 0
    let solveMs = 0
    let status = 'unknown'
    let objectiveValue: number | null = null
    try {
      const parseStartedAt = performance.now()
      await highs.parse(mps, 'mps')
      parseMs = performance.now() - parseStartedAt
      highs.setParam(
        'time_limit',
        Math.max(
          0.1,
          Number.isInteger(timeLimit)
            ? timeLimit + 1e-6
            : timeLimit,
        ),
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
    } finally {
      highs.free()
    }

    return {
      built,
      profile: {
        assignmentVariableCount: built.yByCustomerRecipe.size,
        groupedProductionVariableCount:
          built.groupedProductionUnitsByAssignmentGroupKey.size,
        recipeProductionVariableCount: built.xByRecipeId.size,
        buildMs,
        serializeMs,
        parseMs,
        solveMs,
        status,
        objectiveValue,
      },
    }
  }

  const wasteBuilt = buildHighsStage(
    domain,
    'productionUnits',
    [],
    { aggregateEquivalentAssignments: true },
  )
  const wasteSolution = await wasteBuilt.model.solve()
  if (wasteSolution.status !== 'optimal') {
    throw new Error(
      `Grouped minimum-waste continuation profile ended with status: ${wasteSolution.status}`,
    )
  }
  const productionUnits = Math.round(
    requiredFiniteNumber(
      wasteSolution.objective,
      'grouped minimum-waste continuation objective',
    ),
  )

  const maximumCost = await profileStage(
    () => buildHighsStage(
      domain,
      'negativeAssignedIngredientCost',
      [{ objective: 'productionUnits', value: productionUnits }],
      {
        aggregateEquivalentMaximumCostAssignments: true,
        aggregateEquivalentMaximumCostProductionUnits: true,
      },
    ),
    Math.max(20, timeLimitSeconds),
  )
  if (
    maximumCost.profile.status !== 'optimal' ||
    maximumCost.profile.objectiveValue === null
  ) {
    throw new Error(
      `Grouped maximum-cost continuation profile ended with status: ${maximumCost.profile.status}`,
    )
  }
  const maximumCostOptimum = Math.round(
    maximumCost.profile.objectiveValue,
  )
  const assignedIngredientCost = -maximumCostOptimum
  const slackServings =
    productionUnits * 2 - domain.serviceableCustomerIds.length
  const minimumRecipeCost = Math.min(
    ...domain.recipes
      .filter((recipe) => recipe.eligibleCustomerIds.length > 0)
      .map((recipe) => recipe.juiceUnitIngredientCost),
  )
  const costLowerBound =
    slackServings === 1 &&
    domain.recipes.every(
      (recipe) => (recipe.initialFinishedServings ?? 0) === 0,
    )
      ? (assignedIngredientCost + minimumRecipeCost) / 2
      : null

  const witnessSolution = await maximumCost.built.model.solve()
  if (witnessSolution.status !== 'optimal') {
    throw new Error(
      `Grouped maximum-cost witness ended with status: ${witnessSolution.status}`,
    )
  }
  let witnessProductionCost = 0
  for (const [
    groupKey,
    variable,
  ] of maximumCost.built.groupedProductionUnitsByAssignmentGroupKey) {
    const separatorIndex = groupKey.lastIndexOf('\u001d')
    if (separatorIndex < 0) {
      throw new Error('Maximum-cost profiling group is missing cost identity')
    }
    const ingredientCost = Number(
      groupKey.slice(separatorIndex + 1),
    )
    if (!Number.isFinite(ingredientCost)) {
      throw new Error('Maximum-cost profiling group has invalid cost identity')
    }
    const units = Math.round(
      requiredFiniteNumber(
        witnessSolution.getValue(variable),
        `grouped production units ${groupKey}`,
      ),
    )
    witnessProductionCost += units * ingredientCost
  }

  const costCertificateCloses =
    costLowerBound !== null &&
    Number.isInteger(costLowerBound) &&
    witnessProductionCost === costLowerBound

  const maximumCostFixes: ObjectiveFix[] = [
    { objective: 'productionUnits', value: productionUnits },
    {
      objective: 'negativeAssignedIngredientCost',
      value: maximumCostOptimum,
    },
  ]
  const costGroupedLongResult = await profileStage(
    () => buildHighsStage(
      domain,
      'cost',
      maximumCostFixes,
      {
        aggregateEquivalentMaximumCostAssignments: true,
        aggregateEquivalentMaximumCostProductionUnits: true,
      },
    ),
    Math.max(60, timeLimitSeconds),
  )

  let machineGeneric: StageProfile | null = null
  let machineGrouped: StageProfile | null = null
  if (
    costGroupedLongResult.profile.status === 'optimal' &&
    costGroupedLongResult.profile.objectiveValue !== null
  ) {
    const machineFixes: ObjectiveFix[] = [
      { objective: 'productionUnits', value: productionUnits },
      {
        objective: 'negativeAssignedIngredientCost',
        value: maximumCostOptimum,
      },
      {
        objective: 'cost',
        value: Math.round(
          costGroupedLongResult.profile.objectiveValue,
        ),
      },
    ]
    machineGeneric = (
      await profileStage(
        () => buildHighsStage(
          domain,
          'machineOperations',
          machineFixes,
        ),
        timeLimitSeconds,
      )
    ).profile
    machineGrouped = (
      await profileStage(
        () => buildHighsStage(
          domain,
          'machineOperations',
          machineFixes,
          {
            aggregateEquivalentMaximumCostAssignments: true,
          },
        ),
        timeLimitSeconds,
      )
    ).profile
  }

  return {
    productionUnits,
    maximumCostOptimum,
    assignedIngredientCost,
    slackServings,
    minimumRecipeCost,
    costLowerBound,
    witnessProductionCost,
    costCertificateCloses,
    costGroupedLong: costGroupedLongResult.profile,
    machineGeneric,
    machineGrouped,
  }
}

export async function profileMaximumIngredientCostParityCostStage(
  domain: BatchOptimizationModel,
  productionUnits: number,
  maximumCostOptimum: number,
  timeLimitSeconds = 20,
): Promise<StageProfile & {
  groupCount: number
  oddSlackCount: number
  productionCostObjective: number | null
}> {
  if (
    domain.request.materialSourceMode === 'inventory-only' ||
    domain.recipes.some(
      (recipe) =>
        recipe.maxProductionUnits !== undefined ||
        (recipe.initialFinishedServings ?? 0) > 0,
    )
  ) {
    throw new Error('Parity-cost profiling fixture is not safe')
  }

  const groups = new Map<
    string,
    {
      key: string
      eligibleCustomerIds: string[]
      ingredientCost: number
    }
  >()
  for (const recipe of domain.recipes) {
    const eligibleCustomerIds = [...recipe.eligibleCustomerIds].sort()
    const serviceKey = eligibleCustomerIds.join('\u001e')
    const key =
      `${serviceKey}\u001d${recipe.juiceUnitIngredientCost}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        eligibleCustomerIds,
        ingredientCost: recipe.juiceUnitIngredientCost,
      })
    }
  }
  const assignmentGroups = [...groups.values()]
  const model = new Model()
  const yByCustomerGroup = new Map<string, BoolVariable>()
  const oddByGroup = new Map<string, BoolVariable>()

  const buildStartedAt = performance.now()
  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const variables: BoolVariable[] = []
      assignmentGroups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.boolVar(
          `parity_y_${customerIndex}_${groupIndex}`,
        )
        yByCustomerGroup.set(
          `${customerId}\u001f${group.key}`,
          y,
        )
        variables.push(y)
      })
      model.addConstraint(
        sum(...variables).eq(1),
        `parity_customer_${customerIndex}`,
      )
    },
  )

  const assignedCostTerms: ReturnType<BoolVariable['times']>[] = []
  const oddCostTerms: ReturnType<BoolVariable['times']>[] = []
  assignmentGroups.forEach((group, groupIndex) => {
    const assignmentVars = group.eligibleCustomerIds.flatMap(
      (customerId) => {
        const y = yByCustomerGroup.get(
          `${customerId}\u001f${group.key}`,
        )
        if (!y) return []
        assignedCostTerms.push(y.times(group.ingredientCost))
        return [y]
      },
    )
    const half = model.intVar(
      0,
      Math.floor(group.eligibleCustomerIds.length / 2),
      `parity_half_${groupIndex}`,
    )
    const odd = model.boolVar(`parity_odd_${groupIndex}`)
    oddByGroup.set(group.key, odd)
    oddCostTerms.push(odd.times(group.ingredientCost))
    model.addConstraint(
      sum(...assignmentVars)
        .minus(half.times(2))
        .minus(odd)
        .eq(0),
      `parity_group_${groupIndex}`,
    )
  })

  const assignedIngredientCost = -maximumCostOptimum
  model.addConstraint(
    sum(...assignedCostTerms).eq(assignedIngredientCost),
    'parity_maximum_cost_fix',
  )
  const oddSlackCount =
    productionUnits * 2 - domain.serviceableCustomerIds.length
  model.addConstraint(
    sum(...oddByGroup.values()).eq(oddSlackCount),
    'parity_slack_count',
  )
  model.minimize(sum(...oddCostTerms))
  const buildMs = performance.now() - buildStartedAt

  const serializeStartedAt = performance.now()
  const mps = model.print('mps')
  const serializeMs = performance.now() - serializeStartedAt

  const highs = await HiGHS.create()
  let parseMs = 0
  let solveMs = 0
  let status = 'unknown'
  let objectiveValue: number | null = null
  try {
    const parseStartedAt = performance.now()
    await highs.parse(mps, 'mps')
    parseMs = performance.now() - parseStartedAt
    highs.setParam(
      'time_limit',
      Math.max(
        0.1,
        Number.isInteger(timeLimitSeconds)
          ? timeLimitSeconds + 1e-6
          : timeLimitSeconds,
      ),
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
  } finally {
    highs.free()
  }

  return {
    assignmentVariableCount: yByCustomerGroup.size,
    groupedProductionVariableCount: 0,
    recipeProductionVariableCount: 0,
    groupCount: assignmentGroups.length,
    oddSlackCount,
    buildMs,
    serializeMs,
    parseMs,
    solveMs,
    status,
    objectiveValue,
    productionCostObjective:
      objectiveValue === null
        ? null
        : (assignedIngredientCost + objectiveValue) / 2,
  }
}


export async function profileMaximumIngredientCostMachineStages(
  domain: BatchOptimizationModel,
  productionUnits: number,
  maximumCostOptimum: number,
  productionCostOptimum: number,
  timeLimitSeconds = 10.5,
): Promise<{
  generic: StageProfile
  grouped: StageProfile
}> {
  const profileStage = async (
    grouped: boolean,
  ): Promise<StageProfile> => {
    const fixes: ObjectiveFix[] = [
      { objective: 'productionUnits', value: productionUnits },
      {
        objective: 'negativeAssignedIngredientCost',
        value: maximumCostOptimum,
      },
      { objective: 'cost', value: productionCostOptimum },
    ]
    const buildStartedAt = performance.now()
    const built = buildHighsStage(
      domain,
      'machineOperations',
      fixes,
      grouped
        ? { aggregateEquivalentMaximumCostAssignments: true }
        : {},
    )
    const buildMs = performance.now() - buildStartedAt
    const serializeStartedAt = performance.now()
    const mps = built.model.print('mps')
    const serializeMs = performance.now() - serializeStartedAt

    const highs = await HiGHS.create()
    let parseMs = 0
    let solveMs = 0
    let status = 'unknown'
    let objectiveValue: number | null = null
    try {
      const parseStartedAt = performance.now()
      await highs.parse(mps, 'mps')
      parseMs = performance.now() - parseStartedAt
      highs.setParam(
        'time_limit',
        Math.max(
          0.1,
          Number.isInteger(timeLimitSeconds)
            ? timeLimitSeconds + 1e-6
            : timeLimitSeconds,
        ),
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
    } finally {
      highs.free()
    }

    return {
      assignmentVariableCount: built.yByCustomerRecipe.size,
      groupedProductionVariableCount:
        built.groupedProductionUnitsByAssignmentGroupKey.size,
      recipeProductionVariableCount: built.xByRecipeId.size,
      buildMs,
      serializeMs,
      parseMs,
      solveMs,
      status,
      objectiveValue,
    }
  }

  return {
    generic: await profileStage(false),
    grouped: await profileStage(true),
  }
}


export async function profileMaximumIngredientCostGroupedMachineLong(
  domain: BatchOptimizationModel,
  productionUnits: number,
  maximumCostOptimum: number,
  productionCostOptimum: number,
  timeLimitSeconds = 60,
): Promise<StageProfile> {
  const fixes: ObjectiveFix[] = [
    { objective: 'productionUnits', value: productionUnits },
    {
      objective: 'negativeAssignedIngredientCost',
      value: maximumCostOptimum,
    },
    { objective: 'cost', value: productionCostOptimum },
  ]
  const buildStartedAt = performance.now()
  const built = buildHighsStage(
    domain,
    'machineOperations',
    fixes,
    { aggregateEquivalentMaximumCostAssignments: true },
  )
  const buildMs = performance.now() - buildStartedAt
  const serializeStartedAt = performance.now()
  const mps = built.model.print('mps')
  const serializeMs = performance.now() - serializeStartedAt

  const highs = await HiGHS.create()
  let parseMs = 0
  let solveMs = 0
  let status = 'unknown'
  let objectiveValue: number | null = null
  try {
    const parseStartedAt = performance.now()
    await highs.parse(mps, 'mps')
    parseMs = performance.now() - parseStartedAt
    highs.setParam(
      'time_limit',
      Math.max(
        0.1,
        Number.isInteger(timeLimitSeconds)
          ? timeLimitSeconds + 1e-6
          : timeLimitSeconds,
      ),
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
  } finally {
    highs.free()
  }

  return {
    assignmentVariableCount: built.yByCustomerRecipe.size,
    groupedProductionVariableCount:
      built.groupedProductionUnitsByAssignmentGroupKey.size,
    recipeProductionVariableCount: built.xByRecipeId.size,
    buildMs,
    serializeMs,
    parseMs,
    solveMs,
    status,
    objectiveValue,
  }
}


export async function profileMaximumIngredientCostMachinePartitions(
  domain: BatchOptimizationModel,
  productionUnits: number,
  maximumCostOptimum: number,
  productionCostOptimum: number,
  timeLimitSeconds = 20,
): Promise<Record<string, StageProfile & {
  recipeUnitWitness: RecipeUnitSelection[]
  fullMachineOperations: number | null
}>> {
  const fixes: ObjectiveFix[] = [
    { objective: 'productionUnits', value: productionUnits },
    {
      objective: 'negativeAssignedIngredientCost',
      value: maximumCostOptimum,
    },
    { objective: 'cost', value: productionCostOptimum },
  ]
  const partitions: Array<{
    key: string
    kinds: ProductionStepKind[]
  }> = [
    { key: 'throughSeasoning', kinds: ['juicing', 'seasoning'] },
    { key: 'blending', kinds: ['blending'] },
    { key: 'finalizing', kinds: ['finalizing'] },
  ]
  const result: Record<
    string,
    StageProfile & {
      recipeUnitWitness: RecipeUnitSelection[]
      fullMachineOperations: number | null
    }
  > = {}

  for (const partition of partitions) {
    const buildStartedAt = performance.now()
    const built = buildHighsStage(
      domain,
      'machineOperations',
      fixes,
      {
        relaxAssignmentVariables: true,
        aggregateEquivalentMaximumCostAssignments: true,
        tightenRecipeBoundsFromMinimumCostFix: true,
        tightenOperationBoundsFromRecipeBounds: true,
        machineOperationKinds: new Set(partition.kinds),
      },
    )
    const buildMs = performance.now() - buildStartedAt
    const serializeStartedAt = performance.now()
    const mps = built.model.print('mps')
    const serializeMs = performance.now() - serializeStartedAt

    const highs = await HiGHS.create()
    let parseMs = 0
    let solveMs = 0
    let status = 'unknown'
    let objectiveValue: number | null = null
    let recipeUnitWitness: RecipeUnitSelection[] = []
    try {
      const parseStartedAt = performance.now()
      await highs.parse(mps, 'mps')
      parseMs = performance.now() - parseStartedAt
      highs.setParam(
        'time_limit',
        Math.max(
          0.1,
          Number.isInteger(timeLimitSeconds)
            ? timeLimitSeconds + 1e-6
            : timeLimitSeconds,
        ),
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
      if (solution.status === 'optimal') {
        recipeUnitWitness = selectedRecipeUnits(
          domain,
          built,
          solution as Awaited<ReturnType<Model['solve']>>,
        )
      }
    } finally {
      highs.free()
    }

    result[partition.key] = {
      assignmentVariableCount: built.yByCustomerRecipe.size,
      groupedProductionVariableCount:
        built.groupedProductionUnitsByAssignmentGroupKey.size,
      recipeProductionVariableCount: built.xByRecipeId.size,
      buildMs,
      serializeMs,
      parseMs,
      solveMs,
      status,
      objectiveValue,
      recipeUnitWitness,
      fullMachineOperations:
        recipeUnitWitness.length > 0
          ? machineOperationBreakdownForSelection(
              domain,
              recipeUnitWitness,
            ).total
          : null,
    }
  }

  return result
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
  const maxJarFillOperations =
    domain.request.constraints?.maxJarFillOperations
  if (
    typeof maxJarFillOperations === 'number' &&
    Number.isFinite(maxJarFillOperations)
  ) {
    return null
  }

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

async function diagnoseInventoryOnlyRawShortfall(
  domain: BatchOptimizationModel,
): Promise<Array<{ ingredientId: string; units: number }> | null> {
  if (domain.request.materialSourceMode !== 'inventory-only') {
    return null
  }

  const built = buildHighsStage(
    domain,
    'inventoryShortfall',
    [],
  )
  const solution = await built.model.solve()
  if (solution.status !== 'optimal') return null

  return [...built.inventoryShortfallByIngredientId.entries()]
    .flatMap(([ingredientId, variable]) => {
      if (ingredientId === '__none__') return []
      const units = Math.round(
        requiredFiniteNumber(
          solution.getValue(variable),
          `inventory shortfall ${ingredientId}`,
        ),
      )
      return units > 0 ? [{ ingredientId, units }] : []
    })
    .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))
}

async function diagnoseInventoryOnlyCustomerCapacity(
  domain: BatchOptimizationModel,
): Promise<{
  satisfiableCustomerCount: number
  unfulfilledCustomerIds: string[]
} | null> {
  if (domain.request.materialSourceMode !== 'inventory-only') {
    return null
  }

  const built = buildHighsStage(
    domain,
    'negativeAssignedCustomers',
    [],
    { allowUnassignedCustomers: true },
  )
  const solution = await built.model.solve()
  if (solution.status !== 'optimal') return null

  const satisfiableCustomerIds =
    domain.serviceableCustomerIds.filter((customerId) =>
      domain.recipes.some((recipe) => {
        const variable = built.yByCustomerRecipe.get(
          `${customerId}\u001f${recipe.candidate.id}`,
        )
        return variable
          ? requiredFiniteNumber(
              solution.getValue(variable),
              `inventory diagnostic assignment ${customerId}/${recipe.candidate.id}`,
            ) > 0.5
          : false
      }),
    )
  const satisfiable = new Set(satisfiableCustomerIds)

  return {
    satisfiableCustomerCount: satisfiableCustomerIds.length,
    unfulfilledCustomerIds:
      domain.serviceableCustomerIds.filter(
        (customerId) => !satisfiable.has(customerId),
      ),
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

    const eligibleRecipeIds = new Set(
      domain.recipes.map((recipe) => recipe.candidate.id),
    )
    const includeInitialJarReleaseTieBreak =
      normalizedInitialCarriedJuiceJars(domain.request).some(
        (jar) =>
          Boolean(jar.recipeId) &&
          jar.servings > 0 &&
          eligibleRecipeIds.has(jar.recipeId ?? ''),
      )
    const allowPartialAssignments =
      domain.request.materialSourceMode === 'inventory-only'
    const objectives = objectiveOrder(
      priorities,
      includeInitialJarReleaseTieBreak,
      allowPartialAssignments,
    )
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

      const nextObjectiveKey = objectives[objectiveIndex + 1]
      const shouldTryMachineCertificate =
        currentDomain.recipes.length >=
          PRODUCTION_CERTIFICATE_RECIPE_COUNT_GATE ||
        nextObjectiveKey === 'jarFillOperations'

      if (
        objectiveKey === 'machineOperations' &&
        minimumCostCertificateApplied &&
        fixes.length === 1 &&
        fixes[0].objective === 'cost' &&
        shouldTryMachineCertificate
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
        objectiveKey === 'jarFillOperations' &&
        minimumCostCertificateApplied &&
        machineCertificate &&
        fixes.length === 2 &&
        fixes[0].objective === 'cost' &&
        fixes[1].objective === 'machineOperations' &&
        currentDomain.recipes.length >= PRODUCTION_CERTIFICATE_RECIPE_COUNT_GATE
      ) {
        // The machine certificate proves the global machine optimum equals
        // the sum of independent lower bounds for through-seasoning,
        // blending, and finalizing. Once that total is fixed, finalizing
        // cannot exceed its own lower bound without making another partition
        // fall below a proven lower bound. Therefore the jar-fill optimum is
        // already exact and does not need another production-scale MIP solve.
        fixes.push({
          objective: objectiveKey,
          value: machineCertificate.lowerBounds.finalizing,
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

      let usingMinimumWasteGrouping =
        objectiveIndex === 0 &&
        objectiveKey === 'productionUnits' &&
        fixes.length === 0 &&
        minimumWasteEquivalentAssignmentGroupingIsSafe(stageDomain)
      let usingMaximumIngredientCostGrouping =
        objectiveIndex === 1 &&
        objectiveKey === 'negativeAssignedIngredientCost' &&
        fixes.length === 1 &&
        fixes[0].objective === 'productionUnits' &&
        minimumWasteEquivalentAssignmentGroupingIsSafe(stageDomain)
      let usingMaximumIngredientCostProductionGrouping =
        usingMaximumIngredientCostGrouping &&
        maximumIngredientCostGroupedProductionIsSafe(stageDomain)

      let built = buildHighsStage(
        stageDomain,
        objectiveKey,
        fixes,
        {
          allowUnassignedCustomers: allowPartialAssignments,
          aggregateEquivalentAssignments:
            usingMinimumWasteGrouping,
          aggregateEquivalentMaximumCostAssignments:
            usingMaximumIngredientCostGrouping,
          aggregateEquivalentMaximumCostProductionUnits:
            usingMaximumIngredientCostProductionGrouping,
        },
      )
      let solution = await built.model.solve()

      if (
        (
          usingMinimumWasteGrouping ||
          usingMaximumIngredientCostGrouping
        ) &&
        solution.status !== 'optimal'
      ) {
        usingMinimumWasteGrouping = false
        usingMaximumIngredientCostGrouping = false
        usingMaximumIngredientCostProductionGrouping = false
        built = buildHighsStage(
          stageDomain,
          objectiveKey,
          fixes,
          {
            allowUnassignedCustomers: allowPartialAssignments,
          },
        )
        solution = await built.model.solve()
      }

      if (
        usingMinimumCostCertificate &&
        solution.status !== 'optimal'
      ) {
        stageDomain = domain
        continuationDomain = domain
        usingMinimumCostCertificate = false
        built = buildHighsStage(
          domain,
          objectiveKey,
          fixes,
          { allowUnassignedCustomers: allowPartialAssignments },
        )
        solution = await built.model.solve()
      }

      if (solution.status !== 'optimal') {
        const [
          inventoryShortfalls,
          inventoryCustomerCapacity,
        ] =
          objectiveIndex === 0
            ? await Promise.all([
                diagnoseInventoryOnlyRawShortfall(domain),
                diagnoseInventoryOnlyCustomerCapacity(domain),
              ])
            : [null, null]
        throw new PlanningUserError(
          'optimizer-no-solution',
          {
            solverStatus: solution.status,
            ...(domain.request.materialSourceMode === 'inventory-only'
              ? {
                  materialSourceMode: 'inventory-only' as const,
                  ...(inventoryShortfalls
                    ? { inventoryShortfalls }
                    : {}),
                  ...(inventoryCustomerCapacity
                    ? {
                        inventorySatisfiableCustomerCount:
                          inventoryCustomerCapacity.satisfiableCustomerCount,
                        inventoryUnfulfilledCustomerIds:
                          inventoryCustomerCapacity.unfulfilledCustomerIds,
                      }
                    : {}),
                }
              : {}),
          },
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
    const assignments = finalDomain.serviceableCustomerIds.flatMap(
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
          if (allowPartialAssignments) return []
          throw new Error(
            `HiGHS returned no assignment for ${customerId}`,
          )
        }

        return [{
          customerId,
          recipeId: recipe.candidate.id,
        }]
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
    const assignedRecipeIds = [...new Set(
      assignments.map((assignment) => assignment.recipeId),
    )]
    const recipeKinds = assignedRecipeIds.length
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
      assignedRecipeIds,
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
