import { HiGHS, Model, sum } from '@bubblyworld/highs-ts'
import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { machineOperationBreakdownForSelection } from './optimizerCertificates'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'
import type { ProductionStepKind } from './productionPlan'

const PRODUCTION_UNITS_FIX = 35
const ASSIGNED_INGREDIENT_COST_FIX = 3853
const PRODUCTION_COST_FIX = 1948
const SERVICEABLE_CUSTOMER_COUNT = 69
const GLOBAL_SERVING_SLACK =
  PRODUCTION_UNITS_FIX * 2 - SERVICEABLE_CUSTOMER_COUNT
const SLACK_RECIPE_COST =
  PRODUCTION_COST_FIX * 2 - ASSIGNED_INGREDIENT_COST_FIX

const UNRESOLVED_311_EXTRA3_GROUP_INDEXES = [
  23, 26, 43, 45, 46, 129, 140, 142, 146, 162, 182, 187,
  212, 214, 217, 223, 247, 253, 260, 262, 264, 276, 296,
  297, 307, 313, 344, 399, 403, 406, 456, 457, 460, 461,
  462, 547, 609, 624, 651, 654, 656, 666, 966, 1083, 1279,
] as const

const machineContinuationEnv =
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env ?? {}

const profileIt =
  machineContinuationEnv.MACHINE_CONTINUATION_PROFILE === '1'
    ? it
    : it.skip

const extraIdentityProfileIt =
  machineContinuationEnv.MACHINE_CONTINUATION_PROFILE === '1' &&
  !machineContinuationEnv.MACHINE_CONTINUATION_PARTIAL_GROUPS &&
  !machineContinuationEnv.MACHINE_CONTINUATION_SLACK_SPLIT_GROUPS &&
  !machineContinuationEnv.MACHINE_CONTINUATION_EXTRA_SUM_GROUPS
    ? it
    : it.skip

const partialSupportProfileIt =
  machineContinuationEnv.MACHINE_CONTINUATION_PROFILE === '1' &&
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_PARTIAL_GROUPS)
    ? it
    : it.skip

const slackSplitProfileIt =
  machineContinuationEnv.MACHINE_CONTINUATION_PROFILE === '1' &&
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_SLACK_SPLIT_GROUPS)
    ? it
    : it.skip

const extraSumProfileIt =
  machineContinuationEnv.MACHINE_CONTINUATION_PROFILE === '1' &&
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_EXTRA_SUM_GROUPS)
    ? it
    : it.skip

const supportDpProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_SUPPORT_DP_GROUPS)
    ? it
    : it.skip

const hallSignatureProfileIt =
  machineContinuationEnv.MACHINE_CONTINUATION_HALL_SIGNATURE === '1'
    ? it
    : it.skip

const forcedResidualProfileIt =
  machineContinuationEnv.MACHINE_CONTINUATION_FORCED_RESIDUAL === '1'
    ? it
    : it.skip

const patriciaShardProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_1279_BASE_BRANCHES)
    ? it
    : it.skip

const forcedBaseProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_BASE_GROUP)
    ? it
    : it.skip

const forcedDeepProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_DEEP_GROUP)
    ? it
    : it.skip

const forcedThirdProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_THIRD_GROUP)
    ? it
    : it.skip

const forcedFourthProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_FOURTH_GROUP)
    ? it
    : it.skip

const forcedFifthProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_FIFTH_GROUP)
    ? it
    : it.skip

const forcedSixthProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_SIXTH_GROUP)
    ? it
    : it.skip

const forcedSeventhProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_SEVENTH_GROUP)
    ? it
    : it.skip

const forcedEighthProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_EIGHTH_GROUP)
    ? it
    : it.skip

const forcedNinthProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_NINTH_GROUP)
    ? it
    : it.skip

const forcedSlackProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_SLACK_GROUP)
    ? it
    : it.skip

const forcedRoleProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_FORCED_ROLE_GROUP)
    ? it
    : it.skip

const singleSupportMasterProfileIt =
  Boolean(machineContinuationEnv.MACHINE_CONTINUATION_SINGLE_MASTER_GROUPS)
    ? it
    : it.skip

function canonicalDomain(): BatchOptimizationModel {
  const currentProgress = 'liquid-blender-unlocked'
  const customerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)

  const request: OptimizationRequest = {
    customerIds,
    currentProgress,
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
      'ibex-statue': 999,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'allow-unambiguous-computed',
    objective: 'minimum-waste',
    priorities: ['minimum-waste', 'maximum-ingredient-cost'],
    availableJuiceJarCount: 5,
  }

  return buildOptimizationModel(request, {
    customers: canonicalCustomers,
    candidatePool: buildRecipeCandidatePool(currentProgress),
  })
}

interface PairGroup {
  key: string
  recipes: EligibleOptimizationRecipe[]
  eligibleCustomerIds: string[]
  ingredientCost: number
}

function pairGroups(domain: BatchOptimizationModel): PairGroup[] {
  const groups = new Map<string, PairGroup>()

  for (const recipe of domain.recipes) {
    const eligibleCustomerIds = [
      ...recipe.eligibleCustomerIds,
    ].sort()
    const ingredientCost = recipe.juiceUnitIngredientCost
    const key =
      `${eligibleCustomerIds.join('\u001e')}\u001d${ingredientCost}`
    const current = groups.get(key)
    if (current) current.recipes.push(recipe)
    else {
      groups.set(key, {
        key,
        recipes: [recipe],
        eligibleCustomerIds,
        ingredientCost,
      })
    }
  }

  return [...groups.values()]
}

function customerMaskFlowTypes(
  serviceableCustomerIds: readonly string[],
  maskCustomerIds: ReadonlyMap<string, readonly string[]>,
): Array<{
  customerIds: string[]
  neighborMaskKeys: string[]
}> {
  const maskKeys = [...maskCustomerIds.keys()]
  const types = new Map<
    string,
    {
      customerIds: string[]
      neighborMaskKeys: string[]
    }
  >()

  for (const customerId of serviceableCustomerIds) {
    const neighborMaskKeys = maskKeys.filter((maskKey) =>
      maskCustomerIds.get(maskKey)!.includes(customerId),
    )
    const signature = neighborMaskKeys.join('\u001d')
    const current = types.get(signature)
    if (current) {
      current.customerIds.push(customerId)
    } else {
      types.set(signature, {
        customerIds: [customerId],
        neighborMaskKeys,
      })
    }
  }

  return [...types.values()]
}

function partitionSignature(
  recipe: EligibleOptimizationRecipe,
  kinds: ReadonlySet<ProductionStepKind>,
): {
  key: string
  multiplicityByEdgeKey: Map<string, number>
} {
  const multiplicityByEdgeKey = new Map<string, number>()

  for (const edge of recipe.productionPath.edges) {
    if (!kinds.has(edge.kind)) continue
    multiplicityByEdgeKey.set(
      edge.key,
      (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
    )
  }

  return {
    key: [...multiplicityByEdgeKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([edgeKey, multiplicity]) =>
        `${edgeKey}*${multiplicity}`,
      )
      .join('\u001f'),
    multiplicityByEdgeKey,
  }
}

/**
 * Exact under the current post-maximum-cost parity gate:
 * - every produced unit yields two servings;
 * - there are no initial finished servings;
 * - global serving slack is zero or one;
 * - recipes in a group have the same customer eligibility and unit cost.
 *
 * For fixed integer group production, customer assignment is a bipartite
 * flow with integral capacities/demands, so continuous flow variables do not
 * relax the feasible integer group-production set. When slack is one, route
 * one virtual serving only through groups whose cost equals
 * 2 * productionCost - assignedCost. This makes the assigned-cost fix
 * redundant while preserving it exactly.
 */
function buildFullMachineCapFeasibility(
  domain: BatchOptimizationModel,
  totalCap: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const assignmentsByGroupKey = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(groups.map((group) => [group.key, []]))
  const assignedCostTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  let assignmentVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['boolVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.boolVar(
          `y_${customerIndex}_${groupIndex}`,
        )
        assignmentVariableCount += 1
        customerTerms.push(y)
        assignmentsByGroupKey.get(group.key)!.push(y)
        assignedCostTerms.push(y.times(group.ingredientCost))
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  const finalizingGroupIndexByEdgeKey = new Map<string, number>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
        if (edge.kind === 'finalizing') {
          finalizingGroupIndexByEdgeKey.set(edge.key, groupIndex)
        }
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const assignedCustomers = sum(
      ...(assignmentsByGroupKey.get(group.key) ?? []),
    )
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(assignedCustomers)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(assignedCustomers)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...assignedCostTerms).eq(ASSIGNED_INGREDIENT_COST_FIX),
    'assigned_cost_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  const partitionOperationVars = {
    throughSeasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        partitionOperationVars.throughSeasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...partitionOperationVars.throughSeasoning).geq(38),
    'through_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.blending).geq(35),
    'blending_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).geq(30),
    'finalizing_lower_bound',
  )
  model.addConstraint(
    sum(...operationVars).leq(totalCap),
    'machine_total_cap',
  )
  model.minimize(sum(...productionUnitTerms))

  return {
    model,
    groupCount: groups.length,
    assignmentVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    operationEdgeCount: operationVars.length,
  }
}


function buildPartitionOptimalPairStage(
  domain: BatchOptimizationModel,
  partitionKinds: ReadonlySet<ProductionStepKind>,
  extraThresholdCounts?: readonly [number, number, number, number],
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const coverageByCustomerId = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(domain.serviceableCustomerIds.map((id) => [id, []]))
  const unitVarsByGroupKey = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(groups.map((group) => [group.key, []]))
  const allUnitVars: ReturnType<Model['boolVar']>[] = []
  const singletonVars: ReturnType<Model['boolVar']>[] = []
  const assignedCostTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  const addCoverage = (
    customerId: string,
    variable: ReturnType<Model['boolVar']>,
  ) => {
    const terms = coverageByCustomerId.get(customerId)
    if (!terms) throw new Error(`Unknown customer ${customerId}`)
    terms.push(variable)
  }

  groups.forEach((group, groupIndex) => {
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      group.eligibleCustomerIds.forEach(
        (customerId, customerIndex) => {
          const singleton = model.boolVar(
            `single_${groupIndex}_${customerIndex}`,
          )
          singletonVars.push(singleton)
          allUnitVars.push(singleton)
          unitVarsByGroupKey.get(group.key)!.push(singleton)
          addCoverage(customerId, singleton)
          assignedCostTerms.push(
            singleton.times(group.ingredientCost),
          )
        },
      )
    }

    for (
      let leftIndex = 0;
      leftIndex < group.eligibleCustomerIds.length;
      leftIndex += 1
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < group.eligibleCustomerIds.length;
        rightIndex += 1
      ) {
        const pair = model.boolVar(
          `pair_${groupIndex}_${leftIndex}_${rightIndex}`,
        )
        allUnitVars.push(pair)
        unitVarsByGroupKey.get(group.key)!.push(pair)
        addCoverage(group.eligibleCustomerIds[leftIndex], pair)
        addCoverage(group.eligibleCustomerIds[rightIndex], pair)
        assignedCostTerms.push(
          pair.times(group.ingredientCost * 2),
        )
      }
    }
  })

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      model.addConstraint(
        sum(...(coverageByCustomerId.get(customerId) ?? [])).eq(1),
        `cover_${customerIndex}`,
      )
    },
  )
  model.addConstraint(sum(...singletonVars).eq(1), 'singleton_total')
  model.addConstraint(
    sum(...allUnitVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...assignedCostTerms).eq(ASSIGNED_INGREDIENT_COST_FIX),
    'assigned_cost_fix',
  )

  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  let quotientVariableCount = 0
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const extraThresholdVarsByLevel = Array.from(
    { length: PROCESSING_STACK_CAPACITY - 1 },
    () => [] as ReturnType<Model['boolVar']>[],
  )

  groups.forEach((group, groupIndex) => {
    const signatures = new Map<
      string,
      ReturnType<typeof partitionSignature>
    >()
    for (const recipe of group.recipes) {
      const signature = partitionSignature(recipe, partitionKinds)
      if (!signatures.has(signature.key)) {
        signatures.set(signature.key, signature)
      }
    }

    const upperBound = extraThresholdCounts
      ? Math.min(
          PROCESSING_STACK_CAPACITY,
          Math.max(
            1,
            Math.ceil(group.eligibleCustomerIds.length / 2),
          ),
        )
      : Math.max(
          1,
          Math.ceil(group.eligibleCustomerIds.length / 2),
        )
    const quotientVars: ReturnType<Model['intVar']>[] = []
    const quotientUseVars: ReturnType<Model['boolVar']>[] = []

    for (const signature of signatures.values()) {
      const x = model.intVar(
        0,
        upperBound,
        `qx_${quotientVariableCount}`,
      )
      quotientVariableCount += 1
      quotientVars.push(x)
      if (extraThresholdCounts) {
        const used = model.boolVar(
          `qu_${quotientVariableCount - 1}`,
        )
        quotientUseVars.push(used)
        model.addConstraint(
          x.minus(used.times(upperBound)).leq(0),
          `quotient_use_upper_${quotientVariableCount - 1}`,
        )
        model.addConstraint(
          used.minus(x).leq(0),
          `quotient_use_lower_${quotientVariableCount - 1}`,
        )
      }
      productionCostTerms.push(x.times(group.ingredientCost))
      for (const [edgeKey, multiplicity] of signature.multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            upperBound * multiplicity,
        )
      }
    }

    model.addConstraint(
      sum(...quotientVars)
        .minus(sum(...(unitVarsByGroupKey.get(group.key) ?? [])))
        .eq(0),
      `group_units_${groupIndex}`,
    )

    if (extraThresholdCounts) {
      const usedGroup = model.boolVar(`pug_${groupIndex}`)
      usedGroupVars.push(usedGroup)
      model.addConstraint(
        sum(...quotientUseVars).minus(usedGroup).eq(0),
        `partition_one_signature_${groupIndex}`,
      )
      const groupUnits = sum(
        ...(unitVarsByGroupKey.get(group.key) ?? []),
      )
      const extraThresholds = Array.from(
        { length: Math.max(0, upperBound - 1) },
        (_, thresholdIndex) => {
          const threshold = model.boolVar(
            `pextra_${thresholdIndex + 1}_${groupIndex}`,
          )
          extraThresholdVarsByLevel[thresholdIndex].push(threshold)
          return threshold
        },
      )
      model.addConstraint(
        groupUnits
          .minus(usedGroup)
          .minus(sum(...extraThresholds))
          .eq(0),
        `partition_exact_extra_${groupIndex}`,
      )
      for (
        let thresholdIndex = 1;
        thresholdIndex < extraThresholds.length;
        thresholdIndex += 1
      ) {
        model.addConstraint(
          extraThresholds[thresholdIndex]
            .minus(extraThresholds[thresholdIndex - 1])
            .leq(0),
          `partition_extra_monotone_${groupIndex}_${thresholdIndex}`,
        )
      }
    }
  })

  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  if (extraThresholdCounts) {
    model.addConstraint(
      sum(...usedGroupVars).eq(30),
      'partition_finalizing30_used_groups',
    )
    extraThresholdCounts.forEach((count, thresholdIndex) => {
      model.addConstraint(
        sum(...extraThresholdVarsByLevel[thresholdIndex]).eq(count),
        `partition_extra_count_${thresholdIndex + 1}`,
      )
    })
  }

  const operationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
    },
  )

  model.minimize(sum(...operationVars))
  return {
    model,
    groups,
    unitVarsByGroupKey,
    quotientVariableCount,
    operationEdgeCount: operationVars.length,
  }
}

function buildFixedGroupFullMachineStage(
  domain: BatchOptimizationModel,
  unitsByGroupKey: Map<string, number>,
) {
  const groups = pairGroups(domain).filter(
    (group) => (unitsByGroupKey.get(group.key) ?? 0) > 0,
  )
  const model = new Model()
  const xByRecipeId = new Map<string, ReturnType<Model['intVar']>>()
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()

  let recipeVariableCount = 0
  for (const group of groups) {
    const groupUnits = unitsByGroupKey.get(group.key) ?? 0
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUnits,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      xByRecipeId.set(recipe.candidate.id, x)
      groupRecipeVars.push(x)

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
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
            groupUnits * multiplicity,
        )
      }
    }

    model.addConstraint(
      sum(...groupRecipeVars).eq(groupUnits),
      `group_units_${groups.indexOf(group)}`,
    )
  }

  const operationVars: ReturnType<Model['intVar']>[] = []
  const throughOperationVars: ReturnType<Model['intVar']>[] = []
  const blendingOperationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
    },
  )
  model.minimize(sum(...operationVars))

  return {
    model,
    xByRecipeId,
    selectedGroupCount: groups.length,
    recipeVariableCount,
    operationEdgeCount: operationVars.length,
  }
}


function buildFlowProjectedFullMachineCapFeasibility(
  domain: BatchOptimizationModel,
  totalCap: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  const partitionOperationVars = {
    throughSeasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }
  const finalizingOperationVarsByGroup = groups.map(
    () => [] as ReturnType<Model['intVar']>[],
  )

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        partitionOperationVars.throughSeasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...partitionOperationVars.throughSeasoning).geq(38),
    'through_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.blending).geq(35),
    'blending_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).geq(30),
    'finalizing_lower_bound',
  )
  model.addConstraint(
    sum(...operationVars).leq(totalCap),
    'machine_total_cap',
  )

  // Pure feasibility; all production units are already fixed to 35.
  model.minimize(sum(...productionUnitTerms))

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    operationEdgeCount: operationVars.length,
  }
}



function buildFlowProjectedFullMachineObjectiveStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  const partitionOperationVars = {
    throughSeasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'finalizing') {
        model.addConstraint(
          operation
            .times(PROCESSING_STACK_CAPACITY)
            .minus(quantity)
            .leq(PROCESSING_STACK_CAPACITY - 1),
          `finalizing_exact_ceiling_${edgeIndex}`,
        )
      } else {
        model.addConstraint(
          operation.minus(quantity).leq(0),
          `op_usage_${edgeIndex}`,
        )
      }
      operationVars.push(operation)

      if (kind === 'juicing' || kind === 'seasoning') {
        partitionOperationVars.throughSeasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...partitionOperationVars.throughSeasoning).geq(38),
    'through_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.blending).geq(35),
    'blending_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).geq(30),
    'finalizing_lower_bound',
  )
  model.minimize(sum(...operationVars))

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    operationEdgeCount: operationVars.length,
    finalizingOperationEdgeCount:
      partitionOperationVars.finalizing.length,
  }
}


function buildFlowProjectedNonfinalStage(
  domain: BatchOptimizationModel,
  options?: {
    totalCap?: number
    throughExact?: number
    blendingCap?: number
  },
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'finalizing') continue
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  const throughOperationVars: ReturnType<Model['intVar']>[] = []
  const blendingOperationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        throughOperationVars.push(operation)
      } else if (kind === 'blending') {
        blendingOperationVars.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...throughOperationVars).geq(38),
    'through_exact_lower_bound',
  )
  model.addConstraint(
    sum(...blendingOperationVars).geq(35),
    'blending_exact_lower_bound',
  )
  if (typeof options?.throughExact === 'number') {
    model.addConstraint(
      sum(...throughOperationVars).eq(options.throughExact),
      'through_exact',
    )
  }
  if (typeof options?.blendingCap === 'number') {
    model.addConstraint(
      sum(...blendingOperationVars).leq(options.blendingCap),
      'blending_cap',
    )
  }
  if (typeof options?.totalCap === 'number') {
    model.addConstraint(
      sum(...operationVars).leq(options.totalCap),
      'nonfinal_total_cap',
    )
  }

  model.minimize(sum(...operationVars))

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    operationEdgeCount: operationVars.length,
  }
}


function nonfinalEdgeMultiplicity(
  recipe: EligibleOptimizationRecipe,
): Map<string, number> {
  const result = new Map<string, number>()
  for (const edge of recipe.productionPath.edges) {
    if (edge.kind === 'finalizing') continue
    result.set(edge.key, (result.get(edge.key) ?? 0) + 1)
  }
  return result
}

function edgeMultiplicityIsSubset(
  subset: ReadonlyMap<string, number>,
  superset: ReadonlyMap<string, number>,
): boolean {
  for (const [edgeKey, count] of subset) {
    if ((superset.get(edgeKey) ?? 0) < count) return false
  }
  return true
}

function exactDominatedRecipeIds(
  domain: BatchOptimizationModel,
): Set<string> {
  const dominated = new Set<string>()

  for (const group of pairGroups(domain)) {
    const signatures = group.recipes.map((recipe) => ({
      recipe,
      edges: nonfinalEdgeMultiplicity(recipe),
    }))

    for (let candidateIndex = 0; candidateIndex < signatures.length; candidateIndex += 1) {
      const candidate = signatures[candidateIndex]
      for (let replacementIndex = 0; replacementIndex < signatures.length; replacementIndex += 1) {
        if (candidateIndex === replacementIndex) continue
        const replacement = signatures[replacementIndex]

        if (
          edgeMultiplicityIsSubset(
            replacement.edges,
            candidate.edges,
          )
        ) {
          const strictlyBetter =
            replacement.edges.size < candidate.edges.size ||
            [...candidate.edges.entries()].some(
              ([edgeKey, count]) =>
                (replacement.edges.get(edgeKey) ?? 0) < count,
            )
          if (strictlyBetter) {
            dominated.add(candidate.recipe.candidate.id)
            break
          }
        }
      }
    }
  }

  return dominated
}



function buildFlowProjectedKindsStage(
  domain: BatchOptimizationModel,
  kinds: ReadonlySet<ProductionStepKind>,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (!kinds.has(edge.kind)) continue
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
          Math.min(
            PRODUCTION_UNITS_FIX * multiplicity,
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
              groupUpperBound * multiplicity,
          ),
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const operationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
    },
  )

  model.minimize(sum(...operationVars))
  return {
    model,
    recipeVariableCount,
    operationEdgeCount: operationVars.length,
  }
}


function crossGroupDominatedRecipeIds(
  domain: BatchOptimizationModel,
): {
  dominated: Set<string>
  comparisonCount: number
  maxCostBucketSize: number
} {
  const customerBit = new Map(
    domain.serviceableCustomerIds.map(
      (customerId, index) => [customerId, 1n << BigInt(index)],
    ),
  )
  const byCost = new Map<
    number,
    Array<{
      recipe: EligibleOptimizationRecipe
      eligibleMask: bigint
      eligibleCount: number
      edges: Map<string, number>
      edgeMultiplicityTotal: number
    }>
  >()

  for (const recipe of domain.recipes) {
    let eligibleMask = 0n
    for (const customerId of recipe.eligibleCustomerIds) {
      eligibleMask |= customerBit.get(customerId) ?? 0n
    }
    const edges = nonfinalEdgeMultiplicity(recipe)
    const entry = {
      recipe,
      eligibleMask,
      eligibleCount: recipe.eligibleCustomerIds.length,
      edges,
      edgeMultiplicityTotal: [...edges.values()].reduce(
        (total, count) => total + count,
        0,
      ),
    }
    const bucket = byCost.get(recipe.juiceUnitIngredientCost)
    if (bucket) bucket.push(entry)
    else byCost.set(recipe.juiceUnitIngredientCost, [entry])
  }

  const dominated = new Set<string>()
  let comparisonCount = 0
  let maxCostBucketSize = 0

  for (const bucket of byCost.values()) {
    maxCostBucketSize = Math.max(maxCostBucketSize, bucket.length)

    for (const candidate of bucket) {
      for (const replacement of bucket) {
        if (
          candidate.recipe.candidate.id ===
          replacement.recipe.candidate.id
        ) {
          continue
        }
        if (
          replacement.eligibleCount <
          candidate.eligibleCount
        ) {
          continue
        }
        if (
          replacement.edgeMultiplicityTotal >
          candidate.edgeMultiplicityTotal
        ) {
          continue
        }
        if (
          (replacement.eligibleMask &
            candidate.eligibleMask) !==
          candidate.eligibleMask
        ) {
          continue
        }

        comparisonCount += 1
        if (
          !edgeMultiplicityIsSubset(
            replacement.edges,
            candidate.edges,
          )
        ) {
          continue
        }

        const strictlyBetterEligibility =
          replacement.eligibleMask !==
          candidate.eligibleMask
        const strictlyBetterEdges =
          replacement.edgeMultiplicityTotal <
            candidate.edgeMultiplicityTotal ||
          [...candidate.edges.entries()].some(
            ([edgeKey, count]) =>
              (replacement.edges.get(edgeKey) ?? 0) < count,
          )

        if (
          strictlyBetterEligibility ||
          strictlyBetterEdges
        ) {
          dominated.add(candidate.recipe.candidate.id)
          break
        }
      }
    }
  }

  return {
    dominated,
    comparisonCount,
    maxCostBucketSize,
  }
}



function exactIntegralAssignmentForGroupUnits(
  domain: BatchOptimizationModel,
  unitsByGroupKey: ReadonlyMap<string, number>,
): {
  assignedGroupIndexByCustomerId: Map<string, number>
  slackGroupIndex: number
} {
  const groups = pairGroups(domain)
  const slots: Array<{ groupIndex: number }> = []

  groups.forEach((group, groupIndex) => {
    const units = unitsByGroupKey.get(group.key) ?? 0
    for (let slotIndex = 0; slotIndex < units * 2; slotIndex += 1) {
      slots.push({ groupIndex })
    }
  })

  const realDemands = domain.serviceableCustomerIds.map(
    (customerId) => ({
      id: customerId,
      eligibleGroupIndexes: groups.flatMap((group, groupIndex) =>
        group.eligibleCustomerIds.includes(customerId) &&
        (unitsByGroupKey.get(group.key) ?? 0) > 0
          ? [groupIndex]
          : [],
      ),
    }),
  )
  const slackDemand = {
    id: '__slack__',
    eligibleGroupIndexes: groups.flatMap((group, groupIndex) =>
      group.ingredientCost === SLACK_RECIPE_COST &&
      (unitsByGroupKey.get(group.key) ?? 0) > 0
        ? [groupIndex]
        : [],
    ),
  }

  expect(slots).toHaveLength(
    domain.serviceableCustomerIds.length + GLOBAL_SERVING_SLACK,
  )
  expect(slackDemand.eligibleGroupIndexes.length).toBeGreaterThan(0)

  const demands = [slackDemand, ...realDemands].sort(
    (left, right) =>
      left.eligibleGroupIndexes.length -
      right.eligibleGroupIndexes.length,
  )
  const slotOwner = new Array<number>(slots.length).fill(-1)

  const tryAssign = (
    demandIndex: number,
    visitedSlots: Set<number>,
  ): boolean => {
    const demand = demands[demandIndex]
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      if (visitedSlots.has(slotIndex)) continue
      if (
        !demand.eligibleGroupIndexes.includes(
          slots[slotIndex].groupIndex,
        )
      ) {
        continue
      }
      visitedSlots.add(slotIndex)
      const previousOwner = slotOwner[slotIndex]
      if (
        previousOwner < 0 ||
        tryAssign(previousOwner, visitedSlots)
      ) {
        slotOwner[slotIndex] = demandIndex
        return true
      }
    }
    return false
  }

  for (let demandIndex = 0; demandIndex < demands.length; demandIndex += 1) {
    if (!tryAssign(demandIndex, new Set())) {
      throw new Error(
        `Unable to lift group units into an integral assignment for ${demands[demandIndex].id}`,
      )
    }
  }

  const assignedGroupIndexByCustomerId = new Map<string, number>()
  let slackGroupIndex = -1
  slotOwner.forEach((demandIndex, slotIndex) => {
    if (demandIndex < 0) return
    const demand = demands[demandIndex]
    const groupIndex = slots[slotIndex].groupIndex
    if (demand.id === '__slack__') slackGroupIndex = groupIndex
    else assignedGroupIndexByCustomerId.set(demand.id, groupIndex)
  })

  expect(assignedGroupIndexByCustomerId.size).toBe(
    domain.serviceableCustomerIds.length,
  )
  if (slackGroupIndex < 0) {
    throw new Error('No slack group was assigned')
  }

  return {
    assignedGroupIndexByCustomerId,
    slackGroupIndex,
  }
}

function mipStartValuesForNonfinalWitness(
  domain: BatchOptimizationModel,
  selectedUnitsByRecipeId: ReadonlyMap<string, number>,
): Map<string, number> {
  const groups = pairGroups(domain)
  const unitsByGroupKey = new Map<string, number>()

  for (const group of groups) {
    unitsByGroupKey.set(
      group.key,
      group.recipes.reduce(
        (total, recipe) =>
          total +
          (selectedUnitsByRecipeId.get(recipe.candidate.id) ?? 0),
        0,
      ),
    )
  }

  const assignment = exactIntegralAssignmentForGroupUnits(
    domain,
    unitsByGroupKey,
  )
  const values = new Map<string, number>()

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const groupIndex =
        assignment.assignedGroupIndexByCustomerId.get(customerId)
      if (typeof groupIndex !== 'number') {
        throw new Error(
          `Missing integral assignment for ${customerId}`,
        )
      }
      values.set(`y_${customerIndex}_${groupIndex}`, 1)
    },
  )
  values.set(`slack_${assignment.slackGroupIndex}`, 1)

  const quantityByEdgeKey = new Map<string, number>()
  const edgeIndexByKey = new Map<string, number>()
  let recipeVariableIndex = 0

  for (const group of groups) {
    for (const recipe of group.recipes) {
      const units =
        selectedUnitsByRecipeId.get(recipe.candidate.id) ?? 0
      if (units > 0) {
        values.set(`x_${recipeVariableIndex}`, units)
      }
      recipeVariableIndex += 1

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'finalizing') continue
        if (!edgeIndexByKey.has(edge.key)) {
          edgeIndexByKey.set(edge.key, edgeIndexByKey.size)
        }
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }
      if (units <= 0) continue
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        quantityByEdgeKey.set(
          edgeKey,
          (quantityByEdgeKey.get(edgeKey) ?? 0) +
            units * multiplicity,
        )
      }
    }
  }

  for (const [edgeKey, quantity] of quantityByEdgeKey) {
    if (quantity <= 0) continue
    const edgeIndex = edgeIndexByKey.get(edgeKey)
    if (typeof edgeIndex !== 'number') {
      throw new Error(`Missing operation index for ${edgeKey}`)
    }
    values.set(
      `op_${edgeIndex}`,
      Math.ceil(quantity / PROCESSING_STACK_CAPACITY),
    )
  }

  return values
}


function mipStartValuesForFullWitness(
  domain: BatchOptimizationModel,
  selectedUnitsByRecipeId: ReadonlyMap<string, number>,
): Map<string, number> {
  const groups = pairGroups(domain)
  const unitsByGroupKey = new Map<string, number>()

  for (const group of groups) {
    unitsByGroupKey.set(
      group.key,
      group.recipes.reduce(
        (total, recipe) =>
          total +
          (selectedUnitsByRecipeId.get(recipe.candidate.id) ?? 0),
        0,
      ),
    )
  }

  const assignment = exactIntegralAssignmentForGroupUnits(
    domain,
    unitsByGroupKey,
  )
  const values = new Map<string, number>()

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const groupIndex =
        assignment.assignedGroupIndexByCustomerId.get(customerId)
      if (typeof groupIndex !== 'number') {
        throw new Error(
          `Missing integral assignment for ${customerId}`,
        )
      }
      values.set(`y_${customerIndex}_${groupIndex}`, 1)
    },
  )
  values.set(`slack_${assignment.slackGroupIndex}`, 1)

  const quantityByEdgeKey = new Map<string, number>()
  const edgeIndexByKey = new Map<string, number>()
  let recipeVariableIndex = 0

  for (const group of groups) {
    for (const recipe of group.recipes) {
      const units =
        selectedUnitsByRecipeId.get(recipe.candidate.id) ?? 0
      if (units > 0) {
        values.set(`x_${recipeVariableIndex}`, units)
      }
      recipeVariableIndex += 1

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (!edgeIndexByKey.has(edge.key)) {
          edgeIndexByKey.set(edge.key, edgeIndexByKey.size)
        }
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }
      if (units <= 0) continue
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        quantityByEdgeKey.set(
          edgeKey,
          (quantityByEdgeKey.get(edgeKey) ?? 0) +
            units * multiplicity,
        )
      }
    }
  }

  for (const [edgeKey, quantity] of quantityByEdgeKey) {
    if (quantity <= 0) continue
    const edgeIndex = edgeIndexByKey.get(edgeKey)
    if (typeof edgeIndex !== 'number') {
      throw new Error(`Missing operation index for ${edgeKey}`)
    }
    values.set(
      `op_${edgeIndex}`,
      Math.ceil(quantity / PROCESSING_STACK_CAPACITY),
    )
  }

  return values
}


function miplibSolutionText(
  objective: number,
  values: ReadonlyMap<string, number>,
): string {
  return [
    `=obj= ${objective}`,
    ...[...values.entries()]
      .filter(([, value]) => value !== 0)
      .map(([name, value]) => `${name} ${value}`),
    '',
  ].join('\n')
}

async function solveBoundedWithMIPStart(
  model: Model,
  startValues: ReadonlyMap<string, number>,
  startObjective: number,
  timeLimitSeconds: number,
): Promise<{
  status: string
  objective: number | null
  solveMs: number
  progressTail: string[]
}> {
  const progress: string[] = []
  const highs = await HiGHS.create({
    console: {
      log: (message: string) => progress.push(message),
      error: (message: string) => progress.push(message),
    },
  })
  const startPath = '/tmp/machine-start.sol'
  const runtime = highs as unknown as {
    module: {
      FS: {
        writeFile(path: string, content: string): void
        unlink(path: string): void
      }
    }
  }

  try {
    await highs.parse(model.print('mps'), 'mps')
    runtime.module.FS.writeFile(
      startPath,
      miplibSolutionText(startObjective, startValues),
    )
    highs.setParam('read_solution_file', startPath)
    highs.setParam('time_limit', timeLimitSeconds)
    highs.setParam('mip_rel_gap', 0)
    highs.setParam('mip_abs_gap', 0)

    const startedAt = performance.now()
    const solution = await highs.solve()
    const solveMs = performance.now() - startedAt
    return {
      status: solution.status,
      objective:
        typeof solution.objective === 'number' &&
        Number.isFinite(solution.objective)
          ? solution.objective
          : null,
      solveMs,
      progressTail: progress.slice(-60),
    }
  } finally {
    try {
      runtime.module.FS.unlink(startPath)
    } catch {
      // The solver may have failed before the file was written.
    }
    highs.free()
  }
}


async function solveBoundedWithProgress(
  model: Model,
  timeLimitSeconds: number,
  params?: Readonly<Record<string, boolean | number | string>>,
): Promise<{
  status: string
  objective: number | null
  solveMs: number
  progressTail: string[]
  namedSolution: Map<string, number> | null
}> {
  const progress: string[] = []
  const highs = await HiGHS.create({
    console: {
      log: (message: string) => progress.push(message),
      error: (message: string) => progress.push(message),
    },
  })
  try {
    await highs.parse(model.print('mps'), 'mps')
    highs.setParam('time_limit', timeLimitSeconds)
    for (const [name, value] of Object.entries(params ?? {})) {
      highs.setParam(name, value)
    }
    const startedAt = performance.now()
    const solution = await highs.solve()
    const solveMs = performance.now() - startedAt
    return {
      status: solution.status,
      objective:
        typeof solution.objective === 'number' &&
        Number.isFinite(solution.objective)
          ? solution.objective
          : null,
      solveMs,
      progressTail: progress.slice(-40),
      namedSolution:
        solution.solution instanceof Map
          ? solution.solution
          : null,
    }
  } finally {
    highs.free()
  }
}


function buildConditionalThroughFrontierStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const partitionOperationVars = {
    throughSeasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        partitionOperationVars.throughSeasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...partitionOperationVars.blending).eq(35),
    'blending_exact_frontier',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).eq(30),
    'finalizing_exact_frontier',
  )
  model.minimize(
    sum(...partitionOperationVars.throughSeasoning),
  )

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    throughOperationEdgeCount:
      partitionOperationVars.throughSeasoning.length,
    blendingOperationEdgeCount:
      partitionOperationVars.blending.length,
    finalizingOperationEdgeCount:
      partitionOperationVars.finalizing.length,
  }
}


function buildConditionalSeasoningFrontierStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const partitionOperationVars = {
    juicing: [] as ReturnType<Model['intVar']>[],
    seasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing') {
        partitionOperationVars.juicing.push(operation)
      } else if (kind === 'seasoning') {
        partitionOperationVars.seasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  model.addConstraint(
    sum(...partitionOperationVars.juicing).geq(20),
    'juicing_global_lower_bound',
  )
  model.addConstraint(
    sum(
      ...partitionOperationVars.juicing,
      ...partitionOperationVars.seasoning,
    ).geq(38),
    'through_global_lower_bound',
  )
  model.addConstraint(
    sum(...partitionOperationVars.blending).eq(35),
    'blending_exact_frontier',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).eq(30),
    'finalizing_exact_frontier',
  )
  model.minimize(sum(...partitionOperationVars.seasoning))

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    juicingOperationEdgeCount:
      partitionOperationVars.juicing.length,
    seasoningOperationEdgeCount:
      partitionOperationVars.seasoning.length,
    blendingOperationEdgeCount:
      partitionOperationVars.blending.length,
    finalizingOperationEdgeCount:
      partitionOperationVars.finalizing.length,
  }
}


function buildConditionalThroughCapFeasibility(
  domain: BatchOptimizationModel,
  throughCap: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        customerTerms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const singletonSlackVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()
  let recipeVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      groupRecipeVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProductionUnits = sum(...groupRecipeVars)
    const servedFlow = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      singletonSlackVars.push(slack)
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProductionUnits
          .times(2)
          .minus(servedFlow)
          .eq(0),
        `parity_${groupIndex}`,
      )
    }
  })

  model.addConstraint(
    sum(...singletonSlackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const partitionOperationVars = {
    throughSeasoning: [] as ReturnType<Model['intVar']>[],
    blending: [] as ReturnType<Model['intVar']>[],
    finalizing: [] as ReturnType<Model['intVar']>[],
  }

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        partitionOperationVars.throughSeasoning.push(operation)
      } else if (kind === 'blending') {
        partitionOperationVars.blending.push(operation)
      } else if (kind === 'finalizing') {
        partitionOperationVars.finalizing.push(operation)
      }
    },
  )

  const through = sum(...partitionOperationVars.throughSeasoning)
  model.addConstraint(through.geq(38), 'through_exact_lower_bound')
  model.addConstraint(
    through.leq(throughCap),
    'through_candidate_cap',
  )
  model.addConstraint(
    sum(...partitionOperationVars.blending).eq(35),
    'blending_exact_frontier',
  )
  model.addConstraint(
    sum(...partitionOperationVars.finalizing).eq(30),
    'finalizing_exact_frontier',
  )

  // Pure feasibility: production units are already fixed to 35.
  model.minimize(sum(...productionUnitTerms))

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    singletonSlackVariableCount: singletonSlackVars.length,
    throughOperationEdgeCount:
      partitionOperationVars.throughSeasoning.length,
    blendingOperationEdgeCount:
      partitionOperationVars.blending.length,
    finalizingOperationEdgeCount:
      partitionOperationVars.finalizing.length,
  }
}


function buildFinalizingOptimalGroupCountStage(
  domain: BatchOptimizationModel,
  objective: 'minimum-groups' | 'maximum-groups',
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        terms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const finalOperationVars: ReturnType<Model['intVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []

  groups.forEach((group, groupIndex) => {
    const upperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const x = model.intVar(0, upperBound, `gx_${groupIndex}`)
    productionVars.push(x)
    productionCostTerms.push(x.times(group.ingredientCost))

    const served = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      model.addConstraint(
        x.times(2).minus(served).minus(slack).eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        x.times(2).minus(served).eq(0),
        `parity_${groupIndex}`,
      )
    }

    const op = model.intVar(
      0,
      Math.max(1, Math.ceil(upperBound / PROCESSING_STACK_CAPACITY)),
      `fop_${groupIndex}`,
    )
    finalOperationVars.push(op)
    model.addConstraint(
      x.minus(op.times(PROCESSING_STACK_CAPACITY)).leq(0),
      `fop_capacity_${groupIndex}`,
    )
    model.addConstraint(
      op.minus(x).leq(0),
      `fop_usage_${groupIndex}`,
    )

    const used = model.boolVar(`used_${groupIndex}`)
    usedGroupVars.push(used)
    model.addConstraint(
      x.minus(used.times(upperBound)).leq(0),
      `used_upper_${groupIndex}`,
    )
    model.addConstraint(
      used.minus(x).leq(0),
      `used_lower_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...finalOperationVars).eq(30),
    'finalizing_optimum_fix',
  )

  if (objective === 'minimum-groups') {
    model.minimize(sum(...usedGroupVars))
  } else {
    model.minimize(sum(...usedGroupVars.map((variable) => variable.times(-1))))
  }

  return {
    model,
    groupCount: groups.length,
    usedGroupVars,
  }
}


function buildFinalizing30ReducedStage(
  domain: BatchOptimizationModel,
  objective: 'through' | 'blending' | 'nonfinal-cap' | 'frontier',
  frontier?: {
    blending: number
    throughCap: number
  },
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  let customerFlowVariableCount = 0
  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        customerFlowVariableCount += 1
        terms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const kindByEdgeKey = new Map<string, ProductionStepKind>()

  let recipeVariableCount = 0
  let recipeUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []
    const groupRecipeUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipe of group.recipes) {
      const x = model.intVar(
        0,
        Math.min(groupUpperBound, PROCESSING_STACK_CAPACITY),
        `x_${recipeVariableCount}`,
      )
      recipeVariableCount += 1
      const usedRecipe = model.boolVar(
        `ru_${recipeUseVariableCount}`,
      )
      recipeUseVariableCount += 1

      groupRecipeVars.push(x)
      groupRecipeUseVars.push(usedRecipe)
      productionVars.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      model.addConstraint(
        x
          .minus(
            usedRecipe.times(
              Math.min(groupUpperBound, PROCESSING_STACK_CAPACITY),
            ),
          )
          .leq(0),
        `recipe_use_upper_${recipeVariableCount}`,
      )
      model.addConstraint(
        usedRecipe.minus(x).leq(0),
        `recipe_use_lower_${recipeVariableCount}`,
      )

      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'finalizing') continue
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }
      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            Math.min(groupUpperBound, PROCESSING_STACK_CAPACITY) *
              multiplicity,
        )
      }
    }

    const groupProduction = sum(...groupRecipeVars)
    const served = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      model.addConstraint(
        groupProduction
          .times(2)
          .minus(served)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction.times(2).minus(served).eq(0),
        `parity_${groupIndex}`,
      )
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupRecipeUseVars).minus(usedGroup).eq(0),
      `one_recipe_per_used_group_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const throughOps: ReturnType<Model['intVar']>[] = []
  const blendingOps: ReturnType<Model['intVar']>[] = []

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `op_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `op_usage_${edgeIndex}`,
      )

      const kind = kindByEdgeKey.get(edgeKey)
      if (kind === 'juicing' || kind === 'seasoning') {
        throughOps.push(operation)
      } else if (kind === 'blending') {
        blendingOps.push(operation)
      }
    },
  )

  const through = sum(...throughOps)
  const blending = sum(...blendingOps)
  model.addConstraint(through.geq(38), 'through_lower_bound')
  model.addConstraint(blending.geq(35), 'blending_lower_bound')

  if (objective === 'nonfinal-cap') {
    model.addConstraint(
      through.plus(blending).leq(76),
      'nonfinal_cap_for_total106',
    )
    model.minimize(sum(...productionVars))
  } else if (objective === 'frontier') {
    if (!frontier) {
      throw new Error('Missing finalizing-30 frontier constraints')
    }
    model.addConstraint(
      blending.eq(frontier.blending),
      'blending_frontier_fix',
    )
    model.addConstraint(
      through.leq(frontier.throughCap),
      'through_frontier_cap',
    )
    model.minimize(sum(...productionVars))
  } else if (objective === 'through') {
    model.minimize(through)
  } else {
    model.minimize(blending)
  }

  return {
    model,
    groupCount: groups.length,
    customerFlowVariableCount,
    recipeVariableCount,
    recipeUseVariableCount,
    usedGroupVariableCount: usedGroupVars.length,
    throughOperationEdgeCount: throughOps.length,
    blendingOperationEdgeCount: blendingOps.length,
  }
}


function buildFinalizing30Blending35RawThroughStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        terms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const xNameByRecipeId = new Map<string, string>()
  const rawThroughTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const blendingQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const blendingQuantityUpperBoundByEdgeKey =
    new Map<string, number>()

  let recipeVariableCount = 0
  let recipeUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const cappedUpperBound = Math.min(
      groupUpperBound,
      PROCESSING_STACK_CAPACITY,
    )
    const groupRecipeVars: ReturnType<Model['intVar']>[] = []
    const groupRecipeUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipe of group.recipes) {
      const variableName = `x_${recipeVariableCount}`
      const x = model.intVar(
        0,
        cappedUpperBound,
        variableName,
      )
      recipeVariableCount += 1
      xNameByRecipeId.set(recipe.candidate.id, variableName)

      const usedRecipe = model.boolVar(
        `ru_${recipeUseVariableCount}`,
      )
      recipeUseVariableCount += 1

      groupRecipeVars.push(x)
      groupRecipeUseVars.push(usedRecipe)
      productionVars.push(x)
      productionCostTerms.push(
        x.times(recipe.juiceUnitIngredientCost),
      )

      model.addConstraint(
        x.minus(usedRecipe.times(cappedUpperBound)).leq(0),
        `recipe_use_upper_${recipeVariableCount}`,
      )
      model.addConstraint(
        usedRecipe.minus(x).leq(0),
        `recipe_use_lower_${recipeVariableCount}`,
      )

      let rawThroughMultiplicity = 0
      const blendingMultiplicityByEdgeKey = new Map<string, number>()

      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'juicing' || edge.kind === 'seasoning') {
          rawThroughMultiplicity += 1
        } else if (edge.kind === 'blending') {
          blendingMultiplicityByEdgeKey.set(
            edge.key,
            (blendingMultiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
          )
        }
      }

      if (rawThroughMultiplicity > 0) {
        rawThroughTerms.push(x.times(rawThroughMultiplicity))
      }

      for (
        const [edgeKey, multiplicity]
        of blendingMultiplicityByEdgeKey
      ) {
        const terms = blendingQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else blendingQuantityTermsByEdgeKey.set(edgeKey, [term])
        blendingQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (blendingQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            cappedUpperBound * multiplicity,
        )
      }
    }

    const groupProduction = sum(...groupRecipeVars)
    const served = sum(...(flowByGroupKey.get(group.key) ?? []))

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      model.addConstraint(
        groupProduction
          .times(2)
          .minus(served)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction.times(2).minus(served).eq(0),
        `parity_${groupIndex}`,
      )
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupRecipeUseVars).minus(usedGroup).eq(0),
      `one_recipe_per_used_group_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const blendingOps: ReturnType<Model['intVar']>[] = []
  ;[...blendingQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (blendingQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      blendingOps.push(operation)
    },
  )

  model.addConstraint(
    sum(...blendingOps).eq(35),
    'blending35_frontier',
  )
  model.minimize(sum(...rawThroughTerms))

  return {
    model,
    xNameByRecipeId,
    recipeVariableCount,
    recipeUseVariableCount,
    blendingOperationEdgeCount: blendingOps.length,
  }
}


function buildFinalizing30CompressedFrontierStage(
  domain: BatchOptimizationModel,
  extraThresholdCounts: readonly [number, number, number, number],
  frontier?: {
    nonFinalCap?: number
    blendingFix?: number
    throughCap?: number
  },
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const customerFlowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(
    [...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]),
  )
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `my_${customerIndex}_${maskIndex}`,
          )
          customerFlowVariableCount += 1
          terms.push(y)
          customerFlowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const blendOwnersByEdgeKey = new Map<string, Set<number>>()
  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind !== 'blending') continue
        const owners =
          blendOwnersByEdgeKey.get(edge.key) ?? new Set<number>()
        owners.add(groupIndex)
        blendOwnersByEdgeKey.set(edge.key, owners)
      }
    }
  })
  const sharedBlendEdgeKeys = new Set(
    [...blendOwnersByEdgeKey.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const extraThresholdVarsByLevel = Array.from(
    { length: PROCESSING_STACK_CAPACITY - 1 },
    () => [] as ReturnType<Model['boolVar']>[],
  )
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const slackVarsByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const groupProductionByIndex = new Map<
    number,
    ReturnType<typeof sum>
  >()
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const throughQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const throughQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const sharedBlendQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const privateBlendOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  let classVariableCount = 0
  let classUseVariableCount = 0
  let maxPrivateBlendMultiplicity = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        through: Map<string, number>
        sharedBlend: Map<string, number>
        privateBlendCount: number
      }
    >()

    for (const recipe of group.recipes) {
      const through = new Map<string, number>()
      const sharedBlend = new Map<string, number>()
      let privateBlendCount = 0

      const blendMultiplicity = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'juicing' || edge.kind === 'seasoning') {
          through.set(
            edge.key,
            (through.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      for (const [edgeKey, multiplicity] of blendMultiplicity) {
        if (sharedBlendEdgeKeys.has(edgeKey)) {
          sharedBlend.set(edgeKey, multiplicity)
        } else {
          maxPrivateBlendMultiplicity = Math.max(
            maxPrivateBlendMultiplicity,
            multiplicity,
          )
          if (multiplicity !== 1) {
            throw new Error(
              `Private blending edge multiplicity ${multiplicity} is not safely reducible`,
            )
          }
          privateBlendCount += 1
        }
      }

      const signature = JSON.stringify({
        t: [...through.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        b: [...sharedBlend.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        p: privateBlendCount,
      })
      if (!classes.has(signature)) {
        classes.set(signature, {
          through,
          sharedBlend,
          privateBlendCount,
        })
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `cx_${classVariableCount}`,
      )
      classVariableCount += 1
      const used = model.boolVar(
        `cu_${classUseVariableCount}`,
      )
      classUseVariableCount += 1
      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `class_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `class_use_lower_${classVariableCount}`,
      )

      for (const [edgeKey, multiplicity] of recipeClass.through) {
        const terms = throughQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else throughQuantityTermsByEdgeKey.set(edgeKey, [term])
        throughQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (throughQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedBlend
      ) {
        const terms =
          sharedBlendQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedBlendQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedBlendQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      if (recipeClass.privateBlendCount > 0) {
        privateBlendOperationTerms.push(
          used.times(recipeClass.privateBlendCount),
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    groupProductionByIndex.set(groupIndex, groupProduction)

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `one_class_per_used_group_${groupIndex}`,
    )

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      slackVarsByGroupIndex.set(groupIndex, slack)
      model.addConstraint(
        slack.minus(usedGroup).leq(0),
        `slack_requires_used_group_${groupIndex}`,
      )
    }

    const extraThresholds = Array.from(
      { length: Math.max(0, groupUpperBound - 1) },
      (_, thresholdIndex) => {
        const threshold = model.boolVar(
          `extra_ge_${thresholdIndex + 1}_${groupIndex}`,
        )
        extraThresholdVarsByLevel[thresholdIndex].push(threshold)
        return threshold
      },
    )
    if (extraThresholds.length === 0) {
      model.addConstraint(
        groupProduction.minus(usedGroup).eq(0),
        `group_exact_extra_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction
          .minus(usedGroup)
          .minus(sum(...extraThresholds))
          .eq(0),
        `group_exact_extra_${groupIndex}`,
      )
      for (
        let thresholdIndex = 1;
        thresholdIndex < extraThresholds.length;
        thresholdIndex += 1
      ) {
        model.addConstraint(
          extraThresholds[thresholdIndex]
            .minus(extraThresholds[thresholdIndex - 1])
            .leq(0),
          `group_extra_monotone_${groupIndex}_${thresholdIndex}`,
        )
      }
    }
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlackVars = groupIndexes.flatMap((groupIndex) => {
      const slack = slackVarsByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlackVars))
        .minus(sum(...(customerFlowByMask.get(maskKey) ?? [])))
        .eq(0),
      `mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )
  model.addConstraint(
    sum(...productionVars)
      .minus(sum(...usedGroupVars))
      .eq(PRODUCTION_UNITS_FIX - 30),
    'finalizing30_exact_extra_units',
  )
  extraThresholdCounts.forEach((count, thresholdIndex) => {
    model.addConstraint(
      sum(...extraThresholdVarsByLevel[thresholdIndex]).eq(count),
      `extra_threshold_count_${thresholdIndex + 1}`,
    )
  })

  const throughOps: ReturnType<Model['intVar']>[] = []
  ;[...throughQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (throughQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `top_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `top_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `top_usage_${edgeIndex}`,
      )
      throughOps.push(operation)
    },
  )

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedBlendQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      sharedBlendOps.push(operation)
    },
  )

  const through = sum(...throughOps)
  const blending = sum(
    ...sharedBlendOps,
    ...privateBlendOperationTerms,
  )
  model.addConstraint(through.geq(38), 'through_lower_bound')
  model.addConstraint(blending.geq(35), 'blending_lower_bound')
  if (typeof frontier?.blendingFix === 'number') {
    model.addConstraint(
      blending.eq(frontier.blendingFix),
      'blending_frontier_fix',
    )
  }
  if (typeof frontier?.throughCap === 'number') {
    model.addConstraint(
      through.leq(frontier.throughCap),
      'through_frontier_cap',
    )
  }
  if (typeof frontier?.nonFinalCap === 'number') {
    model.addConstraint(
      through.plus(blending).leq(frontier.nonFinalCap),
      'nonfinal_break_107_cap',
    )
  }
  if (
    typeof frontier?.blendingFix === 'number' ||
    typeof frontier?.throughCap === 'number' ||
    typeof frontier?.nonFinalCap === 'number'
  ) {
    model.minimize(sum(...productionVars))
  } else {
    model.minimize(through.plus(blending))
  }

  return {
    model,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
    groupCount: groups.length,
    classVariableCount,
    classUseVariableCount,
    sharedBlendEdgeCount: sharedBlendEdgeKeys.size,
    sharedBlendOperationEdgeCount: sharedBlendOps.length,
    privateBlendOperationTermCount:
      privateBlendOperationTerms.length,
    throughOperationEdgeCount: throughOps.length,
    maxPrivateBlendMultiplicity,
    extraThresholdVariableCount:
      extraThresholdVarsByLevel.reduce(
        (total, variables) => total + variables.length,
        0,
      ),
  }
}


function buildFinalizing30ConditionalSeasoningStage(
  domain: BatchOptimizationModel,
  blendingFix: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        terms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const blendOwnersByEdgeKey = new Map<string, Set<number>>()
  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind !== 'blending') continue
        const owners =
          blendOwnersByEdgeKey.get(edge.key) ?? new Set<number>()
        owners.add(groupIndex)
        blendOwnersByEdgeKey.set(edge.key, owners)
      }
    }
  })
  const sharedBlendEdgeKeys = new Set(
    [...blendOwnersByEdgeKey.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const seasoningQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const seasoningQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const sharedBlendQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const privateBlendOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  let classVariableCount = 0
  let classUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        seasoning: Map<string, number>
        sharedBlend: Map<string, number>
        privateBlendCount: number
      }
    >()

    for (const recipe of group.recipes) {
      const seasoning = new Map<string, number>()
      const sharedBlend = new Map<string, number>()
      let privateBlendCount = 0
      const blendMultiplicity = new Map<string, number>()

      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'seasoning') {
          seasoning.set(
            edge.key,
            (seasoning.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      for (const [edgeKey, multiplicity] of blendMultiplicity) {
        if (sharedBlendEdgeKeys.has(edgeKey)) {
          sharedBlend.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private blending edge multiplicity ${multiplicity} is not safely reducible`,
            )
          }
          privateBlendCount += 1
        }
      }

      const signature = JSON.stringify({
        s: [...seasoning.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        b: [...sharedBlend.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        p: privateBlendCount,
      })
      if (!classes.has(signature)) {
        classes.set(signature, {
          seasoning,
          sharedBlend,
          privateBlendCount,
        })
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `sx_${classVariableCount}`,
      )
      classVariableCount += 1
      const used = model.boolVar(
        `su_${classUseVariableCount}`,
      )
      classUseVariableCount += 1

      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `class_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `class_use_lower_${classVariableCount}`,
      )

      for (
        const [edgeKey, multiplicity]
        of recipeClass.seasoning
      ) {
        const terms =
          seasoningQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else seasoningQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        seasoningQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (seasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedBlend
      ) {
        const terms =
          sharedBlendQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedBlendQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedBlendQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      if (recipeClass.privateBlendCount > 0) {
        privateBlendOperationTerms.push(
          used.times(recipeClass.privateBlendCount),
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    const served = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      model.addConstraint(
        groupProduction
          .times(2)
          .minus(served)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction.times(2).minus(served).eq(0),
        `parity_${groupIndex}`,
      )
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `one_class_per_used_group_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const seasoningOps: ReturnType<Model['intVar']>[] = []
  ;[...seasoningQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (seasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `sop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `sop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `sop_usage_${edgeIndex}`,
      )
      seasoningOps.push(operation)
    },
  )

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedBlendQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      sharedBlendOps.push(operation)
    },
  )

  const blending = sum(
    ...sharedBlendOps,
    ...privateBlendOperationTerms,
  )
  model.addConstraint(
    blending.eq(blendingFix),
    'blending_frontier_fix',
  )
  model.minimize(sum(...seasoningOps))

  return {
    model,
    groupCount: groups.length,
    classVariableCount,
    classUseVariableCount,
    sharedBlendOperationEdgeCount: sharedBlendOps.length,
    privateBlendOperationTermCount:
      privateBlendOperationTerms.length,
    seasoningOperationEdgeCount: seasoningOps.length,
  }
}


function buildFinalizing30DoubleCompressedSeasoningStage(
  domain: BatchOptimizationModel,
  blendingFix: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()
  const flowByGroupKey = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(groups.map((group) => [group.key, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      groups.forEach((group, groupIndex) => {
        if (!group.eligibleCustomerIds.includes(customerId)) return
        const y = model.numVar(
          0,
          1,
          `y_${customerIndex}_${groupIndex}`,
        )
        terms.push(y)
        flowByGroupKey.get(group.key)!.push(y)
      })
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const ownersByKind = {
    seasoning: new Map<string, Set<number>>(),
    blending: new Map<string, Set<number>>(),
  }

  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind !== 'seasoning' && edge.kind !== 'blending') {
          continue
        }
        const map = ownersByKind[edge.kind]
        const owners = map.get(edge.key) ?? new Set<number>()
        owners.add(groupIndex)
        map.set(edge.key, owners)
      }
    }
  })

  const sharedSeasoningEdgeKeys = new Set(
    [...ownersByKind.seasoning.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )
  const sharedBlendEdgeKeys = new Set(
    [...ownersByKind.blending.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []

  const sharedSeasoningQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedSeasoningQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const sharedBlendQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendQuantityUpperBoundByEdgeKey =
    new Map<string, number>()

  const privateSeasoningOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const privateBlendOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  let classVariableCount = 0
  let classUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        sharedSeasoning: Map<string, number>
        privateSeasoningCount: number
        sharedBlend: Map<string, number>
        privateBlendCount: number
      }
    >()

    for (const recipe of group.recipes) {
      const sharedSeasoning = new Map<string, number>()
      const sharedBlend = new Map<string, number>()
      let privateSeasoningCount = 0
      let privateBlendCount = 0

      const seasoningMultiplicity = new Map<string, number>()
      const blendMultiplicity = new Map<string, number>()

      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'seasoning') {
          seasoningMultiplicity.set(
            edge.key,
            (seasoningMultiplicity.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      for (const [edgeKey, multiplicity] of seasoningMultiplicity) {
        if (sharedSeasoningEdgeKeys.has(edgeKey)) {
          sharedSeasoning.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private seasoning edge multiplicity ${multiplicity} is not safely reducible`,
            )
          }
          privateSeasoningCount += 1
        }
      }

      for (const [edgeKey, multiplicity] of blendMultiplicity) {
        if (sharedBlendEdgeKeys.has(edgeKey)) {
          sharedBlend.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private blending edge multiplicity ${multiplicity} is not safely reducible`,
            )
          }
          privateBlendCount += 1
        }
      }

      const signature = JSON.stringify({
        ss: [...sharedSeasoning.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        ps: privateSeasoningCount,
        sb: [...sharedBlend.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        pb: privateBlendCount,
      })

      if (!classes.has(signature)) {
        classes.set(signature, {
          sharedSeasoning,
          privateSeasoningCount,
          sharedBlend,
          privateBlendCount,
        })
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `dx_${classVariableCount}`,
      )
      classVariableCount += 1
      const used = model.boolVar(
        `du_${classUseVariableCount}`,
      )
      classUseVariableCount += 1

      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `class_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `class_use_lower_${classVariableCount}`,
      )

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedSeasoning
      ) {
        const terms =
          sharedSeasoningQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedSeasoningQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedSeasoningQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedSeasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedBlend
      ) {
        const terms =
          sharedBlendQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedBlendQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedBlendQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      if (recipeClass.privateSeasoningCount > 0) {
        privateSeasoningOperationTerms.push(
          used.times(recipeClass.privateSeasoningCount),
        )
      }
      if (recipeClass.privateBlendCount > 0) {
        privateBlendOperationTerms.push(
          used.times(recipeClass.privateBlendCount),
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    const served = sum(...(flowByGroupKey.get(group.key) ?? []))
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      model.addConstraint(
        groupProduction
          .times(2)
          .minus(served)
          .minus(slack)
          .eq(0),
        `parity_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction.times(2).minus(served).eq(0),
        `parity_${groupIndex}`,
      )
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `one_class_per_used_group_${groupIndex}`,
    )
  })

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const sharedSeasoningOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedSeasoningQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedSeasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `sop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `sop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `sop_usage_${edgeIndex}`,
      )
      sharedSeasoningOps.push(operation)
    },
  )

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedBlendQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      sharedBlendOps.push(operation)
    },
  )

  const seasoning = sum(
    ...sharedSeasoningOps,
    ...privateSeasoningOperationTerms,
  )
  const blending = sum(
    ...sharedBlendOps,
    ...privateBlendOperationTerms,
  )

  model.addConstraint(
    blending.eq(blendingFix),
    'blending_frontier_fix',
  )
  model.minimize(seasoning)

  return {
    model,
    groupCount: groups.length,
    classVariableCount,
    classUseVariableCount,
    sharedSeasoningOperationEdgeCount:
      sharedSeasoningOps.length,
    privateSeasoningOperationTermCount:
      privateSeasoningOperationTerms.length,
    sharedBlendOperationEdgeCount: sharedBlendOps.length,
    privateBlendOperationTermCount:
      privateBlendOperationTerms.length,
  }
}


function buildMaskProjectedFinalizing30SeasoningStage(
  domain: BatchOptimizationModel,
  blendingFix: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const customerFlowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(
    [...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]),
  )
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `my_${customerIndex}_${maskIndex}`,
          )
          customerFlowVariableCount += 1
          customerTerms.push(y)
          customerFlowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const ownersByKind = {
    seasoning: new Map<string, Set<number>>(),
    blending: new Map<string, Set<number>>(),
  }
  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind !== 'seasoning' && edge.kind !== 'blending') {
          continue
        }
        const map = ownersByKind[edge.kind]
        const owners = map.get(edge.key) ?? new Set<number>()
        owners.add(groupIndex)
        map.set(edge.key, owners)
      }
    }
  })

  const sharedSeasoningEdgeKeys = new Set(
    [...ownersByKind.seasoning.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )
  const sharedBlendEdgeKeys = new Set(
    [...ownersByKind.blending.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<
    number,
    ReturnType<ReturnType<Model['intVar']>['plus']>
      | ReturnType<Model['intVar']>
      | ReturnType<typeof sum>
  >()
  const slackVarsByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []

  const sharedSeasoningQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedSeasoningQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const sharedBlendQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const privateSeasoningOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const privateBlendOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  let classVariableCount = 0
  let classUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        sharedSeasoning: Map<string, number>
        privateSeasoningCount: number
        sharedBlend: Map<string, number>
        privateBlendCount: number
      }
    >()

    for (const recipe of group.recipes) {
      const sharedSeasoning = new Map<string, number>()
      const sharedBlend = new Map<string, number>()
      let privateSeasoningCount = 0
      let privateBlendCount = 0
      const seasoningMultiplicity = new Map<string, number>()
      const blendMultiplicity = new Map<string, number>()

      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'seasoning') {
          seasoningMultiplicity.set(
            edge.key,
            (seasoningMultiplicity.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      for (const [edgeKey, multiplicity] of seasoningMultiplicity) {
        if (sharedSeasoningEdgeKeys.has(edgeKey)) {
          sharedSeasoning.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private seasoning multiplicity ${multiplicity}`,
            )
          }
          privateSeasoningCount += 1
        }
      }
      for (const [edgeKey, multiplicity] of blendMultiplicity) {
        if (sharedBlendEdgeKeys.has(edgeKey)) {
          sharedBlend.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private blending multiplicity ${multiplicity}`,
            )
          }
          privateBlendCount += 1
        }
      }

      const signature = JSON.stringify({
        ss: [...sharedSeasoning.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        ps: privateSeasoningCount,
        sb: [...sharedBlend.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        pb: privateBlendCount,
      })
      if (!classes.has(signature)) {
        classes.set(signature, {
          sharedSeasoning,
          privateSeasoningCount,
          sharedBlend,
          privateBlendCount,
        })
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `mx_${classVariableCount}`,
      )
      classVariableCount += 1
      const used = model.boolVar(
        `mu_${classUseVariableCount}`,
      )
      classUseVariableCount += 1

      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `class_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `class_use_lower_${classVariableCount}`,
      )

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedSeasoning
      ) {
        const terms =
          sharedSeasoningQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedSeasoningQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedSeasoningQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedSeasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      for (
        const [edgeKey, multiplicity]
        of recipeClass.sharedBlend
      ) {
        const terms =
          sharedBlendQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else sharedBlendQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedBlendQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }

      if (recipeClass.privateSeasoningCount > 0) {
        privateSeasoningOperationTerms.push(
          used.times(recipeClass.privateSeasoningCount),
        )
      }
      if (recipeClass.privateBlendCount > 0) {
        privateBlendOperationTerms.push(
          used.times(recipeClass.privateBlendCount),
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    groupProductionByIndex.set(groupIndex, groupProduction)

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      slackVarsByGroupIndex.set(groupIndex, slack)
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `one_class_per_used_group_${groupIndex}`,
    )
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlackVars = groupIndexes.flatMap((groupIndex) => {
      const slack = slackVarsByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlackVars))
        .minus(sum(...(customerFlowByMask.get(maskKey) ?? [])))
        .eq(0),
      `mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )

  const sharedSeasoningOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedSeasoningQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedSeasoningQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `sop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `sop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `sop_usage_${edgeIndex}`,
      )
      sharedSeasoningOps.push(operation)
    },
  )

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedBlendQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      sharedBlendOps.push(operation)
    },
  )

  const seasoning = sum(
    ...sharedSeasoningOps,
    ...privateSeasoningOperationTerms,
  )
  const blending = sum(
    ...sharedBlendOps,
    ...privateBlendOperationTerms,
  )
  model.addConstraint(
    blending.eq(blendingFix),
    'blending_frontier_fix',
  )
  model.minimize(seasoning)

  return {
    model,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
    groupCount: groups.length,
    classVariableCount,
    classUseVariableCount,
    sharedSeasoningOperationEdgeCount:
      sharedSeasoningOps.length,
    privateSeasoningOperationTermCount:
      privateSeasoningOperationTerms.length,
    sharedBlendOperationEdgeCount: sharedBlendOps.length,
    privateBlendOperationTermCount:
      privateBlendOperationTerms.length,
  }
}


function buildAggregateSeasoningLowerBoundStage(
  domain: BatchOptimizationModel,
  blendingFix: number,
  extraThresholdCounts?: readonly [number, number, number, number],
  seasoningCap?: number,
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const flowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >([...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]))

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `ay_${customerIndex}_${maskIndex}`,
          )
          terms.push(y)
          flowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const seasoningOwners = new Map<string, Set<number>>()
  const blendingOwners = new Map<string, Set<number>>()
  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'seasoning') {
          const owners =
            seasoningOwners.get(edge.key) ?? new Set<number>()
          owners.add(groupIndex)
          seasoningOwners.set(edge.key, owners)
        } else if (edge.kind === 'blending') {
          const owners =
            blendingOwners.get(edge.key) ?? new Set<number>()
          owners.add(groupIndex)
          blendingOwners.set(edge.key, owners)
        }
      }
    }
  })
  const sharedSeasoningEdgeKeys = new Set(
    [...seasoningOwners.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([key]) => key),
  )
  const sharedBlendEdgeKeys = new Set(
    [...blendingOwners.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([key]) => key),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<number, ReturnType<typeof sum>>()
  const slackByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const extraThresholdVarsByLevel = Array.from(
    { length: PROCESSING_STACK_CAPACITY - 1 },
    () => [] as ReturnType<Model['boolVar']>[],
  )

  const sharedSeasoningQuantityTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  let sharedSeasoningQuantityUpperBound = 0
  const privateSeasoningOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  const sharedBlendQuantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendQuantityUpperBoundByEdgeKey =
    new Map<string, number>()
  const privateBlendOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []

  let classVariableCount = 0
  let classUseVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        privateSeasoningCount: number
        sharedSeasoningCount: number
        sharedBlend: Map<string, number>
        privateBlendCount: number
      }
    >()

    for (const recipe of group.recipes) {
      let privateSeasoningCount = 0
      let sharedSeasoningCount = 0
      let privateBlendCount = 0
      const sharedBlend = new Map<string, number>()

      const seasoningMultiplicity = new Map<string, number>()
      const blendMultiplicity = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'seasoning') {
          seasoningMultiplicity.set(
            edge.key,
            (seasoningMultiplicity.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      for (const [edgeKey, multiplicity] of seasoningMultiplicity) {
        if (multiplicity !== 1) {
          throw new Error(
            `Seasoning multiplicity ${multiplicity} is not supported`,
          )
        }
        if (sharedSeasoningEdgeKeys.has(edgeKey)) {
          sharedSeasoningCount += 1
        } else {
          privateSeasoningCount += 1
        }
      }

      for (const [edgeKey, multiplicity] of blendMultiplicity) {
        if (multiplicity !== 1) {
          throw new Error(
            `Blending multiplicity ${multiplicity} is not supported`,
          )
        }
        if (sharedBlendEdgeKeys.has(edgeKey)) {
          sharedBlend.set(edgeKey, 1)
        } else {
          privateBlendCount += 1
        }
      }

      const signature = JSON.stringify({
        ps: privateSeasoningCount,
        ss: sharedSeasoningCount,
        sb: [...sharedBlend.keys()].sort(),
        pb: privateBlendCount,
      })
      if (!classes.has(signature)) {
        classes.set(signature, {
          privateSeasoningCount,
          sharedSeasoningCount,
          sharedBlend,
          privateBlendCount,
        })
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `ax_${classVariableCount}`,
      )
      classVariableCount += 1
      const used = model.boolVar(
        `au_${classUseVariableCount}`,
      )
      classUseVariableCount += 1

      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))
      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `class_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `class_use_lower_${classVariableCount}`,
      )

      if (recipeClass.privateSeasoningCount > 0) {
        privateSeasoningOperationTerms.push(
          used.times(recipeClass.privateSeasoningCount),
        )
      }
      if (recipeClass.sharedSeasoningCount > 0) {
        sharedSeasoningQuantityTerms.push(
          x.times(recipeClass.sharedSeasoningCount),
        )
        sharedSeasoningQuantityUpperBound +=
          groupUpperBound * recipeClass.sharedSeasoningCount
      }

      for (const edgeKey of recipeClass.sharedBlend.keys()) {
        const terms =
          sharedBlendQuantityTermsByEdgeKey.get(edgeKey)
        const term = x.times(1)
        if (terms) terms.push(term)
        else sharedBlendQuantityTermsByEdgeKey.set(
          edgeKey,
          [term],
        )
        sharedBlendQuantityUpperBoundByEdgeKey.set(
          edgeKey,
          (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound,
        )
      }

      if (recipeClass.privateBlendCount > 0) {
        privateBlendOperationTerms.push(
          used.times(recipeClass.privateBlendCount),
        )
      }
    }

    groupProductionByIndex.set(
      groupIndex,
      sum(...groupProductionVars),
    )

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      slackByGroupIndex.set(groupIndex, slack)
    }

    const usedGroup = model.boolVar(`ug_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `one_class_per_used_group_${groupIndex}`,
    )

    const groupProduction = groupProductionByIndex.get(groupIndex)!
    const extraThresholds = Array.from(
      { length: Math.max(0, groupUpperBound - 1) },
      (_, thresholdIndex) => {
        const threshold = model.boolVar(
          `agg_extra_ge_${thresholdIndex + 1}_${groupIndex}`,
        )
        extraThresholdVarsByLevel[thresholdIndex].push(threshold)
        return threshold
      },
    )
    if (extraThresholds.length === 0) {
      model.addConstraint(
        groupProduction.minus(usedGroup).eq(0),
        `agg_group_exact_extra_${groupIndex}`,
      )
    } else {
      model.addConstraint(
        groupProduction
          .minus(usedGroup)
          .minus(sum(...extraThresholds))
          .eq(0),
        `agg_group_exact_extra_${groupIndex}`,
      )
      for (
        let thresholdIndex = 1;
        thresholdIndex < extraThresholds.length;
        thresholdIndex += 1
      ) {
        model.addConstraint(
          extraThresholds[thresholdIndex]
            .minus(extraThresholds[thresholdIndex - 1])
            .leq(0),
          `agg_extra_monotone_${groupIndex}_${thresholdIndex}`,
        )
      }
    }
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlacks = groupIndexes.flatMap((groupIndex) => {
      const slack = slackByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlacks))
        .minus(sum(...(flowByMask.get(maskKey) ?? [])))
        .eq(0),
      `mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'finalizing30_used_groups',
  )
  model.addConstraint(
    sum(...productionVars)
      .minus(sum(...usedGroupVars))
      .eq(PRODUCTION_UNITS_FIX - 30),
    'finalizing30_exact_extra_units',
  )
  extraThresholdCounts?.forEach((count, thresholdIndex) => {
    model.addConstraint(
      sum(...extraThresholdVarsByLevel[thresholdIndex]).eq(count),
      `agg_extra_threshold_count_${thresholdIndex + 1}`,
    )
  })

  const sharedSeasoningOperation = model.intVar(
    0,
    Math.max(
      1,
      Math.ceil(
        sharedSeasoningQuantityUpperBound /
          PROCESSING_STACK_CAPACITY,
      ),
    ),
    'aggregate_shared_seasoning_op',
  )
  const sharedSeasoningQuantity =
    sum(...sharedSeasoningQuantityTerms)
  model.addConstraint(
    sharedSeasoningQuantity
      .minus(
        sharedSeasoningOperation.times(
          PROCESSING_STACK_CAPACITY,
        ),
      )
      .leq(0),
    'aggregate_shared_seasoning_capacity',
  )
  model.addConstraint(
    sharedSeasoningOperation
      .minus(sharedSeasoningQuantity)
      .leq(0),
    'aggregate_shared_seasoning_usage',
  )

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  ;[...sharedBlendQuantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (sharedBlendQuantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `bop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `bop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `bop_usage_${edgeIndex}`,
      )
      sharedBlendOps.push(operation)
    },
  )

  const seasoningLowerBound = sum(
    sharedSeasoningOperation,
    ...privateSeasoningOperationTerms,
  )
  const blending = sum(
    ...sharedBlendOps,
    ...privateBlendOperationTerms,
  )
  model.addConstraint(
    blending.eq(blendingFix),
    'blending_frontier_fix',
  )
  if (typeof seasoningCap === 'number') {
    model.addConstraint(
      seasoningLowerBound.leq(seasoningCap),
      'aggregate_seasoning_cap',
    )
    model.minimize(sum(...productionVars))
  } else {
    model.minimize(seasoningLowerBound)
  }

  return {
    model,
    serviceMaskCount: maskCustomerIds.size,
    groupCount: groups.length,
    classVariableCount,
    classUseVariableCount,
    sharedBlendOperationEdgeCount: sharedBlendOps.length,
    privateBlendOperationTermCount:
      privateBlendOperationTerms.length,
    privateSeasoningOperationTermCount:
      privateSeasoningOperationTerms.length,
  }
}


function buildExactSharedEdgeMachineStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const flowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >([...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]))
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `fy_${customerIndex}_${maskIndex}`,
          )
          customerFlowVariableCount += 1
          terms.push(y)
          flowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...terms).eq(1),
        `customer_${customerIndex}`,
      )
    },
  )

  const ownersByEdge = new Map<string, Set<string>>()
  for (const recipe of domain.recipes) {
    for (const edge of recipe.productionPath.edges) {
      const owners =
        ownersByEdge.get(edge.key) ?? new Set<string>()
      owners.add(recipe.candidate.id)
      ownersByEdge.set(edge.key, owners)
    }
  }
  const sharedEdgeKeys = new Set(
    [...ownersByEdge.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([edgeKey]) => edgeKey),
  )

  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<number, ReturnType<typeof sum>>()
  const slackByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackVars: ReturnType<Model['boolVar']>[] = []

  const quantityTermsBySharedEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundBySharedEdgeKey =
    new Map<string, number>()
  const localOperationTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []

  let classVariableCount = 0
  let localOperationVariableCount = 0
  let collapsedRecipeCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        shared: Map<string, number>
        localCoefficient: number
        recipeCount: number
      }
    >()

    for (const recipe of group.recipes) {
      const multiplicityByEdge = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdge.set(
          edge.key,
          (multiplicityByEdge.get(edge.key) ?? 0) + 1,
        )
      }

      const shared = new Map<string, number>()
      let localCoefficient = 0
      for (const [edgeKey, multiplicity] of multiplicityByEdge) {
        if (sharedEdgeKeys.has(edgeKey)) {
          shared.set(edgeKey, multiplicity)
        } else {
          if (multiplicity !== 1) {
            throw new Error(
              `Private machine edge multiplicity ${multiplicity} is not safely quotientable`,
            )
          }
          localCoefficient += 1
        }
      }

      const signature = JSON.stringify({
        shared: [...shared.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
        localCoefficient,
      })
      const current = classes.get(signature)
      if (current) {
        current.recipeCount += 1
      } else {
        classes.set(signature, {
          shared,
          localCoefficient,
          recipeCount: 1,
        })
      }
    }

    collapsedRecipeCount +=
      group.recipes.length - classes.size

    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `qx_${classVariableCount}`,
      )
      classVariableCount += 1
      groupProductionVars.push(x)
      productionUnitTerms.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      const localOperation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            groupUpperBound / PROCESSING_STACK_CAPACITY,
          ),
        ),
        `lop_${localOperationVariableCount}`,
      )
      localOperationVariableCount += 1
      model.addConstraint(
        x
          .minus(
            localOperation.times(PROCESSING_STACK_CAPACITY),
          )
          .leq(0),
        `local_capacity_${localOperationVariableCount}`,
      )
      model.addConstraint(
        localOperation.minus(x).leq(0),
        `local_usage_${localOperationVariableCount}`,
      )
      localOperationTerms.push(
        localOperation.times(recipeClass.localCoefficient),
      )

      for (const [edgeKey, multiplicity] of recipeClass.shared) {
        const terms =
          quantityTermsBySharedEdgeKey.get(edgeKey)
        const term = x.times(multiplicity)
        if (terms) terms.push(term)
        else quantityTermsBySharedEdgeKey.set(
          edgeKey,
          [term],
        )
        quantityUpperBoundBySharedEdgeKey.set(
          edgeKey,
          (quantityUpperBoundBySharedEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    groupProductionByIndex.set(groupIndex, groupProduction)

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`slack_${groupIndex}`)
      slackVars.push(slack)
      slackByGroupIndex.set(groupIndex, slack)
      model.addConstraint(
        slack.minus(groupProduction).leq(0),
        `slack_requires_production_${groupIndex}`,
      )
    }
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlacks = groupIndexes.flatMap((groupIndex) => {
      const slack = slackByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlacks))
        .minus(sum(...(flowByMask.get(maskKey) ?? [])))
        .eq(0),
      `mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'global_slack',
  )
  model.addConstraint(
    sum(...productionUnitTerms).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'production_cost_fix',
  )

  const sharedOperationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsBySharedEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundBySharedEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `sop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `shared_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `shared_usage_${edgeIndex}`,
      )
      sharedOperationVars.push(operation)
    },
  )

  model.minimize(
    sum(...sharedOperationVars, ...localOperationTerms),
  )

  return {
    model,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
    groupCount: groups.length,
    classVariableCount,
    localOperationVariableCount,
    sharedOperationEdgeCount: sharedOperationVars.length,
    collapsedRecipeCount,
  }
}

async function solveBounded(
  model: Model,
  timeLimitSeconds: number,
): Promise<{
  status: string
  objective: number | null
  serializeMs: number
  parseMs: number
  solveMs: number
  namedSolution: Map<string, number> | null
}> {
  const serializeStartedAt = performance.now()
  const mps = model.print('mps')
  const serializeMs = performance.now() - serializeStartedAt
  const highs = await HiGHS.create()

  try {
    const parseStartedAt = performance.now()
    await highs.parse(mps, 'mps')
    const parseMs = performance.now() - parseStartedAt
    highs.setParam('time_limit', timeLimitSeconds)

    const solveStartedAt = performance.now()
    const solution = await highs.solve()
    const solveMs = performance.now() - solveStartedAt

    return {
      status: solution.status,
      objective:
        typeof solution.objective === 'number' &&
        Number.isFinite(solution.objective)
          ? solution.objective
          : null,
      serializeMs,
      parseMs,
      solveMs,
      namedSolution:
        solution.solution instanceof Map
          ? solution.solution
          : null,
    }
  } finally {
    highs.free()
  }
}


function buildServiceMaskCompressedNonfinalStage(
  domain: BatchOptimizationModel,
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const customerFlowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >(
    [...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]),
  )
  let customerFlowVariableCount = 0

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const customerTerms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `ny_${customerIndex}_${maskIndex}`,
          )
          customerFlowVariableCount += 1
          customerTerms.push(y)
          customerFlowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...customerTerms).eq(1),
        `nonfinal_customer_${customerIndex}`,
      )
    },
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<
    number,
    ReturnType<typeof sum>
  >()
  const slackVarsByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackVars: ReturnType<Model['boolVar']>[] = []

  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  const edgeKindByKey = new Map<string, 'through' | 'blending'>()

  let classVariableCount = 0
  let collapsedRecipeCount = 0

  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        edges: Array<{
          edgeKey: string
          kind: 'through' | 'blending'
          multiplicity: number
        }>
      }
    >()

    for (const recipe of group.recipes) {
      const edgeMultiplicities = new Map<
        string,
        {
          kind: 'through' | 'blending'
          multiplicity: number
        }
      >()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'finalizing') continue
        const kind =
          edge.kind === 'blending' ? 'blending' : 'through'
        const current = edgeMultiplicities.get(edge.key)
        edgeMultiplicities.set(edge.key, {
          kind,
          multiplicity: (current?.multiplicity ?? 0) + 1,
        })
      }

      const edges = [...edgeMultiplicities.entries()]
        .map(([edgeKey, value]) => ({
          edgeKey,
          kind: value.kind,
          multiplicity: value.multiplicity,
        }))
        .sort((left, right) =>
          left.edgeKey.localeCompare(right.edgeKey),
        )
      const signature = JSON.stringify(edges)
      if (!classes.has(signature)) {
        classes.set(signature, { edges })
      }
    }

    collapsedRecipeCount += group.recipes.length - classes.size

    const groupUpperBound = Math.max(
      1,
      Math.ceil(group.eligibleCustomerIds.length / 2),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []

    for (const recipeClass of classes.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `nx_${classVariableCount}`,
      )
      classVariableCount += 1
      groupProductionVars.push(x)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))

      for (const edge of recipeClass.edges) {
        const terms = quantityTermsByEdgeKey.get(edge.edgeKey)
        const term = x.times(edge.multiplicity)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edge.edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edge.edgeKey,
          (quantityUpperBoundByEdgeKey.get(edge.edgeKey) ?? 0) +
            groupUpperBound * edge.multiplicity,
        )
        const existingKind = edgeKindByKey.get(edge.edgeKey)
        if (existingKind && existingKind !== edge.kind) {
          throw new Error(
            `Machine edge ${edge.edgeKey} changed kind across recipes`,
          )
        }
        edgeKindByKey.set(edge.edgeKey, edge.kind)
      }
    }

    const groupProduction = sum(...groupProductionVars)
    groupProductionByIndex.set(groupIndex, groupProduction)

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`nslack_${groupIndex}`)
      slackVars.push(slack)
      slackVarsByGroupIndex.set(groupIndex, slack)
      model.addConstraint(
        slack.minus(groupProduction).leq(0),
        `nonfinal_slack_requires_production_${groupIndex}`,
      )
    }
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlackVars = groupIndexes.flatMap((groupIndex) => {
      const slack = slackVarsByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlackVars))
        .minus(sum(...(customerFlowByMask.get(maskKey) ?? [])))
        .eq(0),
      `nonfinal_mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'nonfinal_global_slack',
  )
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'nonfinal_production_units_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'nonfinal_production_cost_fix',
  )

  const throughOps: ReturnType<Model['intVar']>[] = []
  const blendingOps: ReturnType<Model['intVar']>[] = []

  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `nop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `nonfinal_op_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `nonfinal_op_usage_${edgeIndex}`,
      )
      if (edgeKindByKey.get(edgeKey) === 'blending') {
        blendingOps.push(operation)
      } else {
        throughOps.push(operation)
      }
    },
  )

  const through = sum(...throughOps)
  const blending = sum(...blendingOps)
  model.addConstraint(
    through.geq(38),
    'nonfinal_through_lower_bound',
  )
  model.addConstraint(
    blending.geq(35),
    'nonfinal_blending_lower_bound',
  )
  model.minimize(through.plus(blending))

  return {
    model,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
    groupCount: groups.length,
    classVariableCount,
    collapsedRecipeCount,
    singletonSlackVariableCount: slackVars.length,
    throughOperationEdgeCount: throughOps.length,
    blendingOperationEdgeCount: blendingOps.length,
  }
}


function buildFinalizing30MaskPartitionStage(
  domain: BatchOptimizationModel,
  partitionKinds: ReadonlySet<ProductionStepKind>,
  extraThresholdCounts: readonly [number, number, number, number],
  operationBounds?: {
    min?: number
    max?: number
  },
  slackExtraCount?: number,
  fixedUsedGroupIndexes?: ReadonlySet<number>,
  fixedSlackGroupIndex?: number,
  fixedExtraByGroupIndex?: ReadonlyMap<number, number>,
) {
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const flowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >([...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]))
  const customerFlowTypes = customerMaskFlowTypes(
    domain.serviceableCustomerIds,
    maskCustomerIds,
  )
  let customerFlowVariableCount = 0
  customerFlowTypes.forEach((customerType, typeIndex) => {
    const demand = customerType.customerIds.length
    const terms = customerType.neighborMaskKeys.map(
      (maskKey, neighborIndex) => {
        const y = model.numVar(
          0,
          demand,
          `mpy_${typeIndex}_${neighborIndex}`,
        )
        customerFlowVariableCount += 1
        flowByMask.get(maskKey)!.push(y)
        return y
      },
    )
    model.addConstraint(
      sum(...terms).eq(demand),
      `mp_customer_type_${typeIndex}`,
    )
  })

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<number, ReturnType<typeof sum>>()
  const slackByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const extraThresholdVarsByLevel = Array.from(
    { length: PROCESSING_STACK_CAPACITY - 1 },
    () => [] as ReturnType<Model['boolVar']>[],
  )
  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const quantityUpperBoundByEdgeKey = new Map<string, number>()
  let classVariableCount = 0

  groups.forEach((group, groupIndex) => {
    const signatures = new Map<
      string,
      ReturnType<typeof partitionSignature>
    >()
    for (const recipe of group.recipes) {
      const signature = partitionSignature(recipe, partitionKinds)
      if (!signatures.has(signature.key)) {
        signatures.set(signature.key, signature)
      }
    }

    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const signature of signatures.values()) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `mpx_${classVariableCount}`,
      )
      const used = model.boolVar(`mpu_${classVariableCount}`)
      classVariableCount += 1
      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))
      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `mp_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `mp_use_lower_${classVariableCount}`,
      )
      for (const [edgeKey, multiplicity] of signature.multiplicityByEdgeKey) {
        const term = x.times(multiplicity)
        const terms = quantityTermsByEdgeKey.get(edgeKey)
        if (terms) terms.push(term)
        else quantityTermsByEdgeKey.set(edgeKey, [term])
        quantityUpperBoundByEdgeKey.set(
          edgeKey,
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) +
            groupUpperBound * multiplicity,
        )
      }
    }

    const groupProduction = sum(...groupProductionVars)
    groupProductionByIndex.set(groupIndex, groupProduction)
    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`mpslack_${groupIndex}`)
      slackVars.push(slack)
      slackByGroupIndex.set(groupIndex, slack)
    }

    const usedGroup = model.boolVar(`mpg_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `mp_one_class_${groupIndex}`,
    )

    const extraThresholds = Array.from(
      { length: Math.max(0, groupUpperBound - 1) },
      (_, thresholdIndex) => {
        const threshold = model.boolVar(
          `mpe_${thresholdIndex + 1}_${groupIndex}`,
        )
        extraThresholdVarsByLevel[thresholdIndex].push(threshold)
        return threshold
      },
    )
    model.addConstraint(
      groupProduction
        .minus(usedGroup)
        .minus(sum(...extraThresholds))
        .eq(0),
      `mp_exact_extra_${groupIndex}`,
    )
    for (
      let thresholdIndex = 1;
      thresholdIndex < extraThresholds.length;
      thresholdIndex += 1
    ) {
      model.addConstraint(
        extraThresholds[thresholdIndex]
          .minus(extraThresholds[thresholdIndex - 1])
          .leq(0),
        `mp_extra_monotone_${groupIndex}_${thresholdIndex}`,
      )
    }
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlacks = groupIndexes.flatMap((groupIndex) => {
      const slack = slackByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlacks))
        .minus(sum(...(flowByMask.get(maskKey) ?? [])))
        .eq(0),
      `mp_mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'mp_global_slack',
  )
  if (typeof fixedSlackGroupIndex === 'number') {
    const fixedSlack = slackByGroupIndex.get(fixedSlackGroupIndex)
    if (!fixedSlack) {
      model.addConstraint(
        sum(...productionVars).leq(-1),
        'mp_invalid_fixed_slack_group',
      )
    } else {
      model.addConstraint(
        fixedSlack.eq(1),
        'mp_fixed_slack_group',
      )
    }
  }
  if (typeof slackExtraCount === 'number') {
    const targetUnits = 1 + slackExtraCount
    const bigM = PROCESSING_STACK_CAPACITY
    groups.forEach((group, groupIndex) => {
      if (group.ingredientCost !== SLACK_RECIPE_COST) return
      const slack = slackByGroupIndex.get(groupIndex)
      const production = groupProductionByIndex.get(groupIndex)
      if (!slack || !production) return
      model.addConstraint(
        sum(production, slack.times(bigM)).leq(targetUnits + bigM),
        `mp_slack_extra_upper_${groupIndex}`,
      )
      model.addConstraint(
        production.minus(slack.times(bigM)).geq(targetUnits - bigM),
        `mp_slack_extra_lower_${groupIndex}`,
      )
    })
  }
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'mp_production_units',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'mp_production_cost',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'mp_used_groups',
  )
  if (fixedUsedGroupIndexes) {
    usedGroupVars.forEach((usedGroup, groupIndex) => {
      model.addConstraint(
        usedGroup.eq(fixedUsedGroupIndexes.has(groupIndex) ? 1 : 0),
        `mp_fixed_used_group_${groupIndex}`,
      )
    })
  }
  if (fixedExtraByGroupIndex) {
    groups.forEach((_group, groupIndex) => {
      const production = groupProductionByIndex.get(groupIndex)
      const usedGroup = usedGroupVars[groupIndex]
      if (!production || !usedGroup) {
        throw new Error(
          `Missing fixed-extra variables for group ${groupIndex}`,
        )
      }
      model.addConstraint(
        production
          .minus(usedGroup)
          .eq(fixedExtraByGroupIndex.get(groupIndex) ?? 0),
        `mp_fixed_extra_${groupIndex}`,
      )
    })
  }
  extraThresholdCounts.forEach((count, thresholdIndex) => {
    model.addConstraint(
      sum(...extraThresholdVarsByLevel[thresholdIndex]).eq(count),
      `mp_extra_count_${thresholdIndex + 1}`,
    )
  })

  const operationVars: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, terms], edgeIndex) => {
      const operation = model.intVar(
        0,
        Math.max(
          1,
          Math.ceil(
            (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
              PROCESSING_STACK_CAPACITY,
          ),
        ),
        `mpop_${edgeIndex}`,
      )
      const quantity = sum(...terms)
      model.addConstraint(
        quantity
          .minus(operation.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `mpop_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operation.minus(quantity).leq(0),
        `mpop_usage_${edgeIndex}`,
      )
      operationVars.push(operation)
    },
  )

  const operations = sum(...operationVars)
  if (typeof operationBounds?.min === 'number') {
    model.addConstraint(
      operations.geq(operationBounds.min),
      'mp_operation_min',
    )
  }
  if (typeof operationBounds?.max === 'number') {
    model.addConstraint(
      operations.leq(operationBounds.max),
      'mp_operation_max',
    )
  }
  model.minimize(operations)
  return {
    model,
    groupCount: groups.length,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
    classVariableCount,
    operationEdgeCount: operationVars.length,
  }
}


function buildAggregateSharedEdgeFrontierMaster(
  domain: BatchOptimizationModel,
  extraThresholdCounts: readonly [number, number, number, number],
  options: {
    slackExtraCount?: number
    totalNonFinalCap?: number
  } = {},
) {
  const slackExtraCount = options.slackExtraCount
  const totalNonFinalCap = options.totalNonFinalCap
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const flowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >([...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]))
  let customerFlowVariableCount = 0
  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      const terms: ReturnType<Model['numVar']>[] = []
      ;[...maskCustomerIds.entries()].forEach(
        ([maskKey, eligibleCustomerIds], maskIndex) => {
          if (!eligibleCustomerIds.includes(customerId)) return
          const y = model.numVar(
            0,
            1,
            `amy_${customerIndex}_${maskIndex}`,
          )
          customerFlowVariableCount += 1
          terms.push(y)
          flowByMask.get(maskKey)!.push(y)
        },
      )
      model.addConstraint(
        sum(...terms).eq(1),
        `am_customer_${customerIndex}`,
      )
    },
  )

  const throughOwners = new Map<string, Set<number>>()
  const blendingOwners = new Map<string, Set<number>>()
  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        const owners =
          edge.kind === 'juicing' || edge.kind === 'seasoning'
            ? throughOwners
            : edge.kind === 'blending'
              ? blendingOwners
              : null
        if (!owners) continue
        const current = owners.get(edge.key) ?? new Set<number>()
        current.add(groupIndex)
        owners.set(edge.key, current)
      }
    }
  })
  const sharedThroughEdgeKeys = new Set(
    [...throughOwners.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([key]) => key),
  )
  const sharedBlendingEdgeKeys = new Set(
    [...blendingOwners.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([key]) => key),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<number, ReturnType<typeof sum>>()
  const slackByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const extraThresholdVarsByLevel = Array.from(
    { length: PROCESSING_STACK_CAPACITY - 1 },
    () => [] as ReturnType<Model['boolVar']>[],
  )

  const privateThroughOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const sharedThroughQuantityTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  let sharedThroughQuantityUpperBound = 0

  const privateBlendingOperationTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const sharedBlendingQuantityTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  let sharedBlendingQuantityUpperBound = 0

  let classVariableCount = 0
  let conflictGroupCount = 0
  groups.forEach((group, groupIndex) => {
    const classes = new Map<
      string,
      {
        privateThroughCount: number
        sharedThroughQuantity: number
        privateBlendingCount: number
        sharedBlendingQuantity: number
      }
    >()

    for (const recipe of group.recipes) {
      const throughMultiplicity = new Map<string, number>()
      const blendingMultiplicity = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'juicing' || edge.kind === 'seasoning') {
          throughMultiplicity.set(
            edge.key,
            (throughMultiplicity.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendingMultiplicity.set(
            edge.key,
            (blendingMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }

      let privateThroughCount = 0
      let sharedThroughQuantity = 0
      for (const [edgeKey, multiplicity] of throughMultiplicity) {
        if (sharedThroughEdgeKeys.has(edgeKey)) {
          sharedThroughQuantity += multiplicity
        } else {
          privateThroughCount += 1
        }
      }

      let privateBlendingCount = 0
      let sharedBlendingQuantity = 0
      for (const [edgeKey, multiplicity] of blendingMultiplicity) {
        if (sharedBlendingEdgeKeys.has(edgeKey)) {
          sharedBlendingQuantity += multiplicity
        } else {
          privateBlendingCount += 1
        }
      }

      const signature = JSON.stringify({
        pt: privateThroughCount,
        st: sharedThroughQuantity,
        pb: privateBlendingCount,
        sb: sharedBlendingQuantity,
      })
      if (!classes.has(signature)) {
        classes.set(signature, {
          privateThroughCount,
          sharedThroughQuantity,
          privateBlendingCount,
          sharedBlendingQuantity,
        })
      }
    }
    const classValues = [...classes.values()]
    const minPrivateThrough = Math.min(
      ...classValues.map((profile) => profile.privateThroughCount),
    )
    const minSharedThrough = Math.min(
      ...classValues.map((profile) => profile.sharedThroughQuantity),
    )
    const minPrivateBlending = Math.min(
      ...classValues.map((profile) => profile.privateBlendingCount),
    )
    const minSharedBlending = Math.min(
      ...classValues.map((profile) => profile.sharedBlendingQuantity),
    )
    const jointMinimum = classValues.find(
      (profile) =>
        profile.privateThroughCount === minPrivateThrough &&
        profile.sharedThroughQuantity === minSharedThrough &&
        profile.privateBlendingCount === minPrivateBlending &&
        profile.sharedBlendingQuantity === minSharedBlending,
    )
    const effectiveClasses = jointMinimum
      ? [jointMinimum]
      : classValues.filter(
          (candidate) =>
            !classValues.some(
              (other) =>
                other !== candidate &&
                other.privateThroughCount <=
                  candidate.privateThroughCount &&
                other.sharedThroughQuantity <=
                  candidate.sharedThroughQuantity &&
                other.privateBlendingCount <=
                  candidate.privateBlendingCount &&
                other.sharedBlendingQuantity <=
                  candidate.sharedBlendingQuantity &&
                (
                  other.privateThroughCount <
                    candidate.privateThroughCount ||
                  other.sharedThroughQuantity <
                    candidate.sharedThroughQuantity ||
                  other.privateBlendingCount <
                    candidate.privateBlendingCount ||
                  other.sharedBlendingQuantity <
                    candidate.sharedBlendingQuantity
                ),
            ),
        )
    if (!jointMinimum) conflictGroupCount += 1


    const groupUpperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const groupProductionVars: ReturnType<Model['intVar']>[] = []
    const groupUseVars: ReturnType<Model['boolVar']>[] = []

    for (const recipeClass of effectiveClasses) {
      const x = model.intVar(
        0,
        groupUpperBound,
        `amx_${classVariableCount}`,
      )
      const used = model.boolVar(`amu_${classVariableCount}`)
      classVariableCount += 1
      groupProductionVars.push(x)
      groupUseVars.push(used)
      productionVars.push(x)
      productionCostTerms.push(x.times(group.ingredientCost))
      model.addConstraint(
        x.minus(used.times(groupUpperBound)).leq(0),
        `am_use_upper_${classVariableCount}`,
      )
      model.addConstraint(
        used.minus(x).leq(0),
        `am_use_lower_${classVariableCount}`,
      )

      if (recipeClass.privateThroughCount > 0) {
        privateThroughOperationTerms.push(
          used.times(recipeClass.privateThroughCount),
        )
      }
      if (recipeClass.sharedThroughQuantity > 0) {
        sharedThroughQuantityTerms.push(
          x.times(recipeClass.sharedThroughQuantity),
        )
        sharedThroughQuantityUpperBound +=
          groupUpperBound * recipeClass.sharedThroughQuantity
      }
      if (recipeClass.privateBlendingCount > 0) {
        privateBlendingOperationTerms.push(
          used.times(recipeClass.privateBlendingCount),
        )
      }
      if (recipeClass.sharedBlendingQuantity > 0) {
        sharedBlendingQuantityTerms.push(
          x.times(recipeClass.sharedBlendingQuantity),
        )
        sharedBlendingQuantityUpperBound +=
          groupUpperBound * recipeClass.sharedBlendingQuantity
      }
    }

    const groupProduction = sum(...groupProductionVars)
    groupProductionByIndex.set(groupIndex, groupProduction)

    const usedGroup = model.boolVar(`amg_${groupIndex}`)
    usedGroupVars.push(usedGroup)
    model.addConstraint(
      sum(...groupUseVars).minus(usedGroup).eq(0),
      `am_one_class_${groupIndex}`,
    )

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`amslack_${groupIndex}`)
      slackVars.push(slack)
      slackByGroupIndex.set(groupIndex, slack)
    }

    const extraThresholds = Array.from(
      { length: Math.max(0, groupUpperBound - 1) },
      (_, thresholdIndex) => {
        const threshold = model.boolVar(
          `ame_${thresholdIndex + 1}_${groupIndex}`,
        )
        extraThresholdVarsByLevel[thresholdIndex].push(threshold)
        return threshold
      },
    )
    model.addConstraint(
      groupProduction
        .minus(usedGroup)
        .minus(sum(...extraThresholds))
        .eq(0),
      `am_exact_extra_${groupIndex}`,
    )
    for (
      let thresholdIndex = 1;
      thresholdIndex < extraThresholds.length;
      thresholdIndex += 1
    ) {
      model.addConstraint(
        extraThresholds[thresholdIndex]
          .minus(extraThresholds[thresholdIndex - 1])
          .leq(0),
        `am_extra_monotone_${groupIndex}_${thresholdIndex}`,
      )
    }
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlacks = groupIndexes.flatMap((groupIndex) => {
      const slack = slackByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlacks))
        .minus(sum(...(flowByMask.get(maskKey) ?? [])))
        .eq(0),
      `am_mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'am_global_slack',
  )
  if (typeof slackExtraCount === 'number') {
    const targetUnits = 1 + slackExtraCount
    const bigM = PROCESSING_STACK_CAPACITY
    groups.forEach((group, groupIndex) => {
      if (group.ingredientCost !== SLACK_RECIPE_COST) return
      const slack = slackByGroupIndex.get(groupIndex)
      const production = groupProductionByIndex.get(groupIndex)
      if (!slack || !production) return
      model.addConstraint(
        sum(production, slack.times(bigM)).leq(targetUnits + bigM),
        `am_slack_extra_upper_${groupIndex}`,
      )
      model.addConstraint(
        production.minus(slack.times(bigM)).geq(targetUnits - bigM),
        `am_slack_extra_lower_${groupIndex}`,
      )
    })
  }
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'am_production_units',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'am_production_cost',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'am_used_groups',
  )
  extraThresholdCounts.forEach((count, thresholdIndex) => {
    model.addConstraint(
      sum(...extraThresholdVarsByLevel[thresholdIndex]).eq(count),
      `am_extra_count_${thresholdIndex + 1}`,
    )
  })

  const sharedThroughOperation = model.intVar(
    0,
    Math.max(
      1,
      Math.ceil(
        sharedThroughQuantityUpperBound / PROCESSING_STACK_CAPACITY,
      ),
    ),
    'am_shared_through_operation',
  )
  const sharedThroughQuantity = sum(...sharedThroughQuantityTerms)
  model.addConstraint(
    sharedThroughQuantity
      .minus(
        sharedThroughOperation.times(PROCESSING_STACK_CAPACITY),
      )
      .leq(0),
    'am_shared_through_capacity',
  )
  model.addConstraint(
    sharedThroughOperation.minus(sharedThroughQuantity).leq(0),
    'am_shared_through_usage',
  )

  const sharedBlendingOperation = model.intVar(
    0,
    Math.max(
      1,
      Math.ceil(
        sharedBlendingQuantityUpperBound /
          PROCESSING_STACK_CAPACITY,
      ),
    ),
    'am_shared_blending_operation',
  )
  const sharedBlendingQuantity = sum(...sharedBlendingQuantityTerms)
  model.addConstraint(
    sharedBlendingQuantity
      .minus(
        sharedBlendingOperation.times(PROCESSING_STACK_CAPACITY),
      )
      .leq(0),
    'am_shared_blending_capacity',
  )
  model.addConstraint(
    sharedBlendingOperation.minus(sharedBlendingQuantity).leq(0),
    'am_shared_blending_usage',
  )

  const optimisticThrough = sum(
    ...privateThroughOperationTerms,
    sharedThroughOperation,
  )
  const optimisticBlending = sum(
    ...privateBlendingOperationTerms,
    sharedBlendingOperation,
  )
  if (typeof totalNonFinalCap === 'number') {
    model.addConstraint(
      optimisticThrough.plus(optimisticBlending).leq(totalNonFinalCap),
      'am_optimistic_nonfinal_cap',
    )
  } else {
    model.addConstraint(
      optimisticThrough.leq(41),
      'am_optimistic_through_cap',
    )
    model.addConstraint(
      optimisticBlending.leq(35),
      'am_optimistic_blending_cap',
    )
  }

  model.minimize(sum(...productionVars))
  return {
    model,
    groupCount: groups.length,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
    classVariableCount,
    conflictGroupCount,
    sharedThroughEdgeCount: sharedThroughEdgeKeys.size,
    sharedBlendingEdgeCount: sharedBlendingEdgeKeys.size,
  }
}





/**
 * Exact support master for the remaining 3+1+1 / slackExtra=0 frontier
 * once the extra=3 group and singleton slack group are fixed.
 *
 * With finalizing=30 and 35 production units:
 * - 30 used groups contribute one base unit each;
 * - the fixed extra=3 group contributes three additional units;
 * - exactly two other used groups contribute one additional unit each.
 *
 * This removes the generic integer-production / threshold encoding without
 * changing the feasible group-support set for this fixed case.
 */

/**
 * Exact support master for 3+1+1 / slackExtra=0 after fixing the
 * extra=3 service+cost group and the sum of the two extra=1 costs.
 *
 * The unique slack group remains endogenous. This is a complete case
 * partition over the symmetric pair of extra=1 groups, while the fixed
 * cost sum also fixes the base-support ingredient-cost sum.
 */
function build311ExtraCostSumSupportMaster(
  domain: BatchOptimizationModel,
  fixedExtra3GroupIndex: number,
  extraOneCostSum: number | undefined,
  options: {
    supportCuts?: readonly (readonly number[])[]
    hallCuts?: readonly (readonly number[])[]
    includeCustomerFlow?: boolean
    forcedCustomerIds?: readonly string[]
    requiredUsedGroupIndexes?: readonly number[]
    requiredSlackGroupIndexes?: readonly number[]
    forbiddenSlackGroupIndexes?: readonly number[]
    requiredExtraOneGroupIndexes?: readonly number[]
    forbiddenExtraOneGroupIndexes?: readonly number[]
  } = {},
) {
  const supportCuts = options.supportCuts ?? []
  const hallCuts = options.hallCuts ?? []
  const includeCustomerFlow = options.includeCustomerFlow ?? true
  const forcedCustomerIds = new Set(options.forcedCustomerIds ?? [])
  const requiredUsedGroupIndexes =
    options.requiredUsedGroupIndexes ?? []
  const requiredSlackGroupIndexes =
    options.requiredSlackGroupIndexes ?? []
  const forbiddenSlackGroupIndexes =
    options.forbiddenSlackGroupIndexes ?? []
  const requiredExtraOneGroupIndexes =
    options.requiredExtraOneGroupIndexes ?? []
  const forbiddenExtraOneGroupIndexes =
    options.forbiddenExtraOneGroupIndexes ?? []
  const groups = pairGroups(domain)
  const model = new Model()
  const effectiveEligibleCustomerIds = groups.map((group, groupIndex) =>
    groupIndex === fixedExtra3GroupIndex && forcedCustomerIds.size > 0
      ? []
      : group.eligibleCustomerIds.filter(
          (customerId) => !forcedCustomerIds.has(customerId),
        ),
  )
  const residualServiceableCustomerIds =
    domain.serviceableCustomerIds.filter(
      (customerId) => !forcedCustomerIds.has(customerId),
    )
  const maskKeyForIds = (customerIds: readonly string[]) =>
    customerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((_group, groupIndex) => {
    const eligibleCustomerIds = effectiveEligibleCustomerIds[groupIndex]
    const maskKey = maskKeyForIds(eligibleCustomerIds)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const flowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >([...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]))
  if (includeCustomerFlow) {
    customerMaskFlowTypes(
      residualServiceableCustomerIds,
      maskCustomerIds,
    ).forEach((customerType, typeIndex) => {
      const demand = customerType.customerIds.length
      const terms = customerType.neighborMaskKeys.map(
        (maskKey, neighborIndex) => {
          const flow = model.numVar(
            0,
            demand,
            `s31sy_${typeIndex}_${neighborIndex}`,
          )
          flowByMask.get(maskKey)!.push(flow)
          return flow
        },
      )
      model.addConstraint(
        sum(...terms).eq(demand),
        `s31s_customer_type_${typeIndex}`,
      )
    })
  }

  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const extraOneByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const slackByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const productionCostTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const extraOneCostTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const capacityTermsByGroupIndex = new Map<
    number,
    ReturnType<ReturnType<Model['boolVar']>['times']>[]
  >()

  groups.forEach((group, groupIndex) => {
    const residualEligibleCount =
      effectiveEligibleCustomerIds[groupIndex].length
    const upperBound =
      groupIndex === fixedExtra3GroupIndex
        ? Math.min(
            PROCESSING_STACK_CAPACITY,
            Math.max(
              1,
              Math.ceil(group.eligibleCustomerIds.length / 2),
            ),
          )
        : Math.min(
            PROCESSING_STACK_CAPACITY,
            Math.ceil(residualEligibleCount / 2),
          )
    const used = model.boolVar(`s31su_${groupIndex}`)
    usedGroupVars.push(used)

    if (groupIndex === fixedExtra3GroupIndex) {
      if (upperBound < 4) {
        model.addConstraint(
          used.leq(-1),
          's31s_invalid_extra3_capacity',
        )
      }
      model.addConstraint(
        used.eq(1),
        's31s_fixed_extra3_used',
      )
      productionCostTerms.push(
        used.times(group.ingredientCost * 4),
      )
      capacityTermsByGroupIndex.set(groupIndex, [
        used.times(8),
      ])
      return
    }

    if (upperBound === 0) {
      model.addConstraint(
        used.eq(0),
        `s31s_residual_ineligible_${groupIndex}`,
      )
    }
    productionCostTerms.push(used.times(group.ingredientCost))
    const capacityTerms = [used.times(2)]
    let extraOne:
      | ReturnType<Model['boolVar']>
      | undefined
    if (upperBound >= 2) {
      extraOne = model.boolVar(`s31se1_${groupIndex}`)
      extraOneByGroupIndex.set(groupIndex, extraOne)
      model.addConstraint(
        extraOne.minus(used).leq(0),
        `s31s_extra_used_${groupIndex}`,
      )
      productionCostTerms.push(
        extraOne.times(group.ingredientCost),
      )
      extraOneCostTerms.push(
        extraOne.times(group.ingredientCost),
      )
      capacityTerms.push(extraOne.times(2))
    }

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`s31sslack_${groupIndex}`)
      slackByGroupIndex.set(groupIndex, slack)
      model.addConstraint(
        slack.minus(used).leq(0),
        `s31s_slack_used_${groupIndex}`,
      )
      if (extraOne) {
        model.addConstraint(
          slack.plus(extraOne).leq(1),
          `s31s_slack_no_extra_${groupIndex}`,
        )
      }
      capacityTerms.push(slack.times(-1))
    }
    capacityTermsByGroupIndex.set(groupIndex, capacityTerms)
  })

  requiredUsedGroupIndexes.forEach((groupIndex, index) => {
    const used = usedGroupVars[groupIndex]
    if (!used) {
      model.addConstraint(
        sum(...usedGroupVars).leq(-1),
        `s31s_invalid_required_used_${index}`,
      )
      return
    }
    model.addConstraint(
      used.eq(1),
      `s31s_required_used_${index}`,
    )
  })
  requiredSlackGroupIndexes.forEach((groupIndex, index) => {
    const slack = slackByGroupIndex.get(groupIndex)
    if (!slack) {
      model.addConstraint(
        sum(...usedGroupVars).leq(-1),
        `s31s_invalid_required_slack_${index}`,
      )
      return
    }
    model.addConstraint(
      slack.eq(1),
      `s31s_required_slack_${index}`,
    )
  })
  forbiddenSlackGroupIndexes.forEach((groupIndex, index) => {
    const slack = slackByGroupIndex.get(groupIndex)
    if (!slack) return
    model.addConstraint(
      slack.eq(0),
      `s31s_forbidden_slack_${index}`,
    )
  })
  requiredExtraOneGroupIndexes.forEach((groupIndex, index) => {
    const extraOne = extraOneByGroupIndex.get(groupIndex)
    if (!extraOne) {
      model.addConstraint(
        sum(...usedGroupVars).leq(-1),
        `s31s_invalid_required_extra_one_${index}`,
      )
      return
    }
    model.addConstraint(
      extraOne.eq(1),
      `s31s_required_extra_one_${index}`,
    )
  })
  forbiddenExtraOneGroupIndexes.forEach((groupIndex, index) => {
    const extraOne = extraOneByGroupIndex.get(groupIndex)
    if (!extraOne) return
    model.addConstraint(
      extraOne.eq(0),
      `s31s_forbidden_extra_one_${index}`,
    )
  })

  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    's31s_used_groups',
  )
  model.addConstraint(
    sum(...extraOneByGroupIndex.values()).eq(2),
    's31s_extra_one_groups',
  )
  model.addConstraint(
    sum(...slackByGroupIndex.values()).eq(1),
    's31s_slack_group',
  )
  if (forcedCustomerIds.size > 0) {
    residualServiceableCustomerIds.forEach((customerId, customerIndex) => {
      const coverTerms = groups.flatMap((group, groupIndex) => {
        if (
          groupIndex === fixedExtra3GroupIndex ||
          !effectiveEligibleCustomerIds[groupIndex].includes(customerId)
        ) {
          return []
        }
        if (effectiveEligibleCustomerIds[groupIndex].length >= 2) {
          return [usedGroupVars[groupIndex]]
        }
        const slack = slackByGroupIndex.get(groupIndex)
        return slack ? [slack] : []
      })
      if (coverTerms.length > 0 && coverTerms.length <= 3) {
        model.addConstraint(
          sum(...coverTerms).geq(1),
          `s31s_sparse_customer_cover_${customerIndex}`,
        )
      }
    })
  }
  if (typeof extraOneCostSum === 'number') {
    model.addConstraint(
      sum(...extraOneCostTerms).eq(extraOneCostSum),
      's31s_extra_one_cost_sum',
    )
  }
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    's31s_production_cost',
  )

  if (includeCustomerFlow) {
    let maskIndex = 0
    for (const [maskKey, groupIndexes] of groupIndexesByMask) {
      const capacityTerms = groupIndexes.flatMap(
        (groupIndex) =>
          forcedCustomerIds.size > 0 &&
          groupIndex === fixedExtra3GroupIndex
            ? []
            : capacityTermsByGroupIndex.get(groupIndex) ?? [],
      )
      model.addConstraint(
        sum(...capacityTerms)
          .minus(sum(...(flowByMask.get(maskKey) ?? [])))
          .eq(0),
        `s31s_mask_capacity_${maskIndex}`,
      )
      maskIndex += 1
    }
  }

  hallCuts.forEach((groupIndexes, cutIndex) => {
    const customerIds = new Set<string>()
    const capacityTerms = groupIndexes.flatMap((groupIndex) => {
      for (const customerId of effectiveEligibleCustomerIds[groupIndex]) {
        customerIds.add(customerId)
      }
      if (
        forcedCustomerIds.size > 0 &&
        groupIndex === fixedExtra3GroupIndex
      ) {
        return []
      }
      return capacityTermsByGroupIndex.get(groupIndex) ?? []
    })
    model.addConstraint(
      sum(...capacityTerms).leq(customerIds.size),
      `s31s_hall_cut_${cutIndex}`,
    )
  })

  supportCuts.forEach((support, cutIndex) => {
    model.addConstraint(
      sum(
        ...support.map(
          (groupIndex) => usedGroupVars[groupIndex],
        ),
      ).leq(29),
      `s31s_support_nogood_${cutIndex}`,
    )
  })

  model.minimize(sum(...usedGroupVars))
  return { model, groups }
}


forcedRoleProfileIt(
  'splits selected forced-customer branches by fixed-group extra-one roles',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_ROLE_GROUP,
    )
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
              extraOneEligible: residualEligible.length >= 4,
            }]
          : []
      })
    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
      choices: Array<{ customerId: string; groupIndex: number }>
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
      choices: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
          choices: [
            ...branch.choices,
            {
              customerId: branchCustomer.customerId,
              groupIndex: candidate.groupIndex,
            },
          ],
        })),
      )
    }
    const requestedBranches =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_ROLE_BRANCHES ??
        ''
      )
        .split(',')
        .map((value) => Number(value.trim()))
        .filter(
          (value) =>
            Number.isInteger(value) &&
            value >= 0 &&
            value < branches.length,
        )
    expect(requestedBranches.length).toBeGreaterThan(0)

    const results = []
    for (const branchIndex of requestedBranches) {
      const branch = branches[branchIndex]
      const eligibleRoleGroups = [...new Set(
        branch.requiredUsedGroupIndexes.filter(
          (requiredGroupIndex) => {
            if (requiredGroupIndex === groupIndex) return false
            const residualEligible =
              groups[requiredGroupIndex].eligibleCustomerIds.filter(
                (customerId) => !fixedCustomers.has(customerId),
              )
            return residualEligible.length >= 4
          },
        ),
      )]
      expect(eligibleRoleGroups.length).toBeGreaterThan(0)
      const roleCases = 1 << eligibleRoleGroups.length
      for (let roleMask = 0; roleMask < roleCases; roleMask += 1) {
        const requiredExtraOneGroupIndexes =
          eligibleRoleGroups.filter(
            (_roleGroupIndex, bitIndex) =>
              (roleMask & (1 << bitIndex)) !== 0,
          )
        const forbiddenExtraOneGroupIndexes =
          eligibleRoleGroups.filter(
            (_roleGroupIndex, bitIndex) =>
              (roleMask & (1 << bitIndex)) === 0,
          )
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes:
              branch.requiredUsedGroupIndexes,
            requiredSlackGroupIndexes:
              branch.requiredSlackGroupIndexes,
            requiredExtraOneGroupIndexes,
            forbiddenExtraOneGroupIndexes,
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        results.push({
          branchIndex,
          eligibleRoleGroups,
          roleMask,
          requiredExtraOneGroupIndexes,
          forbiddenExtraOneGroupIndexes,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-role-split-summary]',
      JSON.stringify({
        groupIndex,
        requestedBranches,
        totalCases: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )

    const slackGroupIndex = 1243
    expect(groups[slackGroupIndex].ingredientCost).toBe(SLACK_RECIPE_COST)
    const combinedResults = []
    for (const parent of unresolved) {
      const branch = branches[parent.branchIndex]
      for (const slackCase of ['required', 'forbidden'] as const) {
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes:
              branch.requiredUsedGroupIndexes,
            requiredSlackGroupIndexes:
              slackCase === 'required'
                ? [
                    ...branch.requiredSlackGroupIndexes,
                    slackGroupIndex,
                  ]
                : branch.requiredSlackGroupIndexes,
            forbiddenSlackGroupIndexes:
              slackCase === 'forbidden'
                ? [slackGroupIndex]
                : [],
            requiredExtraOneGroupIndexes:
              parent.requiredExtraOneGroupIndexes,
            forbiddenExtraOneGroupIndexes:
              parent.forbiddenExtraOneGroupIndexes,
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        combinedResults.push({
          branchIndex: parent.branchIndex,
          roleMask: parent.roleMask,
          slackCase,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolvedCombined = combinedResults.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-role-slack-summary]',
      JSON.stringify({
        groupIndex,
        parentCases: unresolved.length,
        totalCases: combinedResults.length,
        infeasibleCount:
          combinedResults.length - unresolvedCombined.length,
        unresolvedCount: unresolvedCombined.length,
        unresolved: unresolvedCombined,
      }),
    )
    expect(unresolvedCombined).toEqual([])
  },
  120000,
)

forcedSlackProfileIt(
  'splits selected forced-customer branches by cost-43 slack identity',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_SLACK_GROUP,
    )
    const slackGroupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_SLACK_IDENTITY,
    )
    expect(Number.isInteger(groupIndex)).toBe(true)
    expect(Number.isInteger(slackGroupIndex)).toBe(true)
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)
    expect(groups[slackGroupIndex].ingredientCost).toBe(SLACK_RECIPE_COST)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })
    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
        })),
      )
    }

    const requestedBranches =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_SLACK_BRANCHES ??
        ''
      )
        .split(',')
        .map((value) => Number(value.trim()))
        .filter(
          (value) =>
            Number.isInteger(value) &&
            value >= 0 &&
            value < branches.length,
        )
    expect(requestedBranches.length).toBeGreaterThan(0)

    const results = []
    for (const branchIndex of requestedBranches) {
      const branch = branches[branchIndex]
      for (const slackCase of ['required', 'forbidden'] as const) {
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes:
              branch.requiredUsedGroupIndexes,
            requiredSlackGroupIndexes:
              slackCase === 'required'
                ? [
                    ...branch.requiredSlackGroupIndexes,
                    slackGroupIndex,
                  ]
                : branch.requiredSlackGroupIndexes,
            forbiddenSlackGroupIndexes:
              slackCase === 'forbidden'
                ? [slackGroupIndex]
                : [],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        results.push({
          branchIndex,
          slackCase,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-slack-split-summary]',
      JSON.stringify({
        groupIndex,
        slackGroupIndex,
        requestedBranches,
        totalCases: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )
    expect(unresolved).toEqual([])
  },
  120000,
)

forcedNinthProfileIt(
  'checks fixed ninth-level sparse-customer cases for a forced identity',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_NINTH_GROUP,
    )
    expect(Number.isInteger(groupIndex)).toBe(true)
    expect(groups[groupIndex]).toBeDefined()
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    const branchCustomerIds = new Set(
      branchCustomers.map((entry) => entry.customerId),
    )
    const sparseCustomers = residualCustomerIds
      .filter((customerId) => !branchCustomerIds.has(customerId))
      .map((customerId) => ({
        customerId,
        candidates: candidatesForCustomer(customerId),
      }))
      .sort(
        (left, right) =>
          left.candidates.length - right.candidates.length,
      )
    const selectedSparse = sparseCustomers.slice(0, 9)
    expect(selectedSparse.length).toBe(9)

    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
        })),
      )
    }

    const requestedCases =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_NINTH_CASES ??
        ''
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const [
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
            fourthChoiceIndex,
            fifthChoiceIndex,
            sixthChoiceIndex,
            seventhChoiceIndex,
            eighthChoiceIndex,
          ] = value.split(':').map(Number)
          return {
            branchIndex,
            choiceIndexes: [
              firstChoiceIndex,
              secondChoiceIndex,
              thirdChoiceIndex,
              fourthChoiceIndex,
              fifthChoiceIndex,
              sixthChoiceIndex,
              seventhChoiceIndex,
              eighthChoiceIndex,
            ],
          }
        })
        .filter((entry) =>
          Number.isInteger(entry.branchIndex) &&
          entry.branchIndex >= 0 &&
          entry.branchIndex < branches.length &&
          entry.choiceIndexes.every(
            (choiceIndex, index) =>
              Number.isInteger(choiceIndex) &&
              choiceIndex >= 0 &&
              choiceIndex < selectedSparse[index].candidates.length,
          )
        )
    expect(requestedCases.length).toBeGreaterThan(0)

    const ninthSparse = selectedSparse[8]
    const results = []
    for (const requested of requestedCases) {
      const branch = branches[requested.branchIndex]
      const priorChoices = requested.choiceIndexes.map(
        (choiceIndex, index) =>
          selectedSparse[index].candidates[choiceIndex],
      )
      for (
        let ninthChoiceIndex = 0;
        ninthChoiceIndex < ninthSparse.candidates.length;
        ninthChoiceIndex += 1
      ) {
        const ninthChoice =
          ninthSparse.candidates[ninthChoiceIndex]
        const allChoices = [...priorChoices, ninthChoice]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              ...allChoices.map((choice) => choice.groupIndex),
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...allChoices
                .filter((choice) => choice.slackOnly)
                .map((choice) => choice.groupIndex),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        results.push({
          branchIndex: requested.branchIndex,
          choiceIndexes: requested.choiceIndexes,
          ninthChoiceIndex,
          ninthChoiceGroupIndex: ninthChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-ninth-summary]',
      JSON.stringify({
        groupIndex,
        sparseCustomers: selectedSparse.map((entry) => ({
          customerId: entry.customerId,
          candidateCount: entry.candidates.length,
        })),
        ninthSparseCustomer: ninthSparse.customerId,
        ninthSparseCandidateCount: ninthSparse.candidates.length,
        requestedCases,
        totalBranches: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )
    expect(unresolved).toEqual([])
  },
  120000,
)

forcedEighthProfileIt(
  'checks fixed eighth-level sparse-customer shards for a forced identity',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_EIGHTH_GROUP,
    )
    expect(Number.isInteger(groupIndex)).toBe(true)
    expect(groups[groupIndex]).toBeDefined()
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    const branchCustomerIds = new Set(
      branchCustomers.map((entry) => entry.customerId),
    )
    const sparseCustomers = residualCustomerIds
      .filter((customerId) => !branchCustomerIds.has(customerId))
      .map((customerId) => ({
        customerId,
        candidates: candidatesForCustomer(customerId),
      }))
      .sort(
        (left, right) =>
          left.candidates.length - right.candidates.length,
      )
    const selectedSparse = sparseCustomers.slice(0, 8)
    expect(selectedSparse.length).toBe(8)

    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
        })),
      )
    }

    const requestedCases =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_EIGHTH_CASES ??
        ''
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const [
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
            fourthChoiceIndex,
            fifthChoiceIndex,
            sixthChoiceIndex,
            seventhChoiceIndex,
          ] = value.split(':').map(Number)
          return {
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
            fourthChoiceIndex,
            fifthChoiceIndex,
            sixthChoiceIndex,
            seventhChoiceIndex,
          }
        })
        .filter((entry) => {
          const choiceIndexes = [
            entry.firstChoiceIndex,
            entry.secondChoiceIndex,
            entry.thirdChoiceIndex,
            entry.fourthChoiceIndex,
            entry.fifthChoiceIndex,
            entry.sixthChoiceIndex,
            entry.seventhChoiceIndex,
          ]
          return (
            Number.isInteger(entry.branchIndex) &&
            entry.branchIndex >= 0 &&
            entry.branchIndex < branches.length &&
            choiceIndexes.every(
              (choiceIndex, index) =>
                Number.isInteger(choiceIndex) &&
                choiceIndex >= 0 &&
                choiceIndex < selectedSparse[index].candidates.length,
            )
          )
        })
    expect(requestedCases.length).toBeGreaterThan(0)

    const eighthSparse = selectedSparse[7]
    const results = []
    for (const requested of requestedCases) {
      const branch = branches[requested.branchIndex]
      const priorIndexes = [
        requested.firstChoiceIndex,
        requested.secondChoiceIndex,
        requested.thirdChoiceIndex,
        requested.fourthChoiceIndex,
        requested.fifthChoiceIndex,
        requested.sixthChoiceIndex,
        requested.seventhChoiceIndex,
      ]
      const priorChoices = priorIndexes.map(
        (choiceIndex, index) =>
          selectedSparse[index].candidates[choiceIndex],
      )
      for (
        let eighthChoiceIndex = 0;
        eighthChoiceIndex < eighthSparse.candidates.length;
        eighthChoiceIndex += 1
      ) {
        const eighthChoice =
          eighthSparse.candidates[eighthChoiceIndex]
        const allChoices = [...priorChoices, eighthChoice]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              ...allChoices.map((choice) => choice.groupIndex),
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...allChoices
                .filter((choice) => choice.slackOnly)
                .map((choice) => choice.groupIndex),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        results.push({
          ...requested,
          eighthChoiceIndex,
          eighthChoiceGroupIndex: eighthChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-eighth-shard-summary]',
      JSON.stringify({
        groupIndex,
        sparseCustomers: selectedSparse.map((entry) => ({
          customerId: entry.customerId,
          candidateCount: entry.candidates.length,
        })),
        eighthSparseCustomer: eighthSparse.customerId,
        eighthSparseCandidateCount: eighthSparse.candidates.length,
        requestedCases,
        totalBranches: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )
    expect(unresolved).toEqual([])
  },
  120000,
)

forcedSeventhProfileIt(
  'checks fixed seventh-level sparse-customer shards for a forced identity',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_SEVENTH_GROUP,
    )
    expect(Number.isInteger(groupIndex)).toBe(true)
    expect(groups[groupIndex]).toBeDefined()
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    const branchCustomerIds = new Set(
      branchCustomers.map((entry) => entry.customerId),
    )
    const sparseCustomers = residualCustomerIds
      .filter((customerId) => !branchCustomerIds.has(customerId))
      .map((customerId) => ({
        customerId,
        candidates: candidatesForCustomer(customerId),
      }))
      .sort(
        (left, right) =>
          left.candidates.length - right.candidates.length,
      )
    const firstSparse = sparseCustomers[0]
    const secondSparse = sparseCustomers[1]
    const thirdSparse = sparseCustomers[2]
    const fourthSparse = sparseCustomers[3]
    const fifthSparse = sparseCustomers[4]
    const sixthSparse = sparseCustomers[5]
    const seventhSparse = sparseCustomers[6]
    expect(firstSparse).toBeDefined()
    expect(secondSparse).toBeDefined()
    expect(thirdSparse).toBeDefined()
    expect(fourthSparse).toBeDefined()
    expect(fifthSparse).toBeDefined()
    expect(sixthSparse).toBeDefined()
    expect(seventhSparse).toBeDefined()
    if (
      !firstSparse ||
      !secondSparse ||
      !thirdSparse ||
      !fourthSparse ||
      !fifthSparse ||
      !sixthSparse ||
      !seventhSparse
    ) return

    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
        })),
      )
    }

    const requestedCases =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_SEVENTH_CASES ??
        ''
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const [
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
            fourthChoiceIndex,
            fifthChoiceIndex,
            sixthChoiceIndex,
          ] = value.split(':').map(Number)
          return {
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
            fourthChoiceIndex,
            fifthChoiceIndex,
            sixthChoiceIndex,
          }
        })
        .filter((entry) =>
          Number.isInteger(entry.branchIndex) &&
          entry.branchIndex >= 0 &&
          entry.branchIndex < branches.length &&
          Number.isInteger(entry.firstChoiceIndex) &&
          entry.firstChoiceIndex >= 0 &&
          entry.firstChoiceIndex < firstSparse.candidates.length &&
          Number.isInteger(entry.secondChoiceIndex) &&
          entry.secondChoiceIndex >= 0 &&
          entry.secondChoiceIndex < secondSparse.candidates.length &&
          Number.isInteger(entry.thirdChoiceIndex) &&
          entry.thirdChoiceIndex >= 0 &&
          entry.thirdChoiceIndex < thirdSparse.candidates.length &&
          Number.isInteger(entry.fourthChoiceIndex) &&
          entry.fourthChoiceIndex >= 0 &&
          entry.fourthChoiceIndex < fourthSparse.candidates.length &&
          Number.isInteger(entry.fifthChoiceIndex) &&
          entry.fifthChoiceIndex >= 0 &&
          entry.fifthChoiceIndex < fifthSparse.candidates.length &&
          Number.isInteger(entry.sixthChoiceIndex) &&
          entry.sixthChoiceIndex >= 0 &&
          entry.sixthChoiceIndex < sixthSparse.candidates.length
        )
    expect(requestedCases.length).toBeGreaterThan(0)

    const results = []
    for (const requested of requestedCases) {
      const branch = branches[requested.branchIndex]
      const firstChoice =
        firstSparse.candidates[requested.firstChoiceIndex]
      const secondChoice =
        secondSparse.candidates[requested.secondChoiceIndex]
      const thirdChoice =
        thirdSparse.candidates[requested.thirdChoiceIndex]
      const fourthChoice =
        fourthSparse.candidates[requested.fourthChoiceIndex]
      const fifthChoice =
        fifthSparse.candidates[requested.fifthChoiceIndex]
      const sixthChoice =
        sixthSparse.candidates[requested.sixthChoiceIndex]
      for (
        let seventhChoiceIndex = 0;
        seventhChoiceIndex < seventhSparse.candidates.length;
        seventhChoiceIndex += 1
      ) {
        const seventhChoice =
          seventhSparse.candidates[seventhChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              firstChoice.groupIndex,
              secondChoice.groupIndex,
              thirdChoice.groupIndex,
              fourthChoice.groupIndex,
              fifthChoice.groupIndex,
              sixthChoice.groupIndex,
              seventhChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(firstChoice.slackOnly
                ? [firstChoice.groupIndex]
                : []),
              ...(secondChoice.slackOnly
                ? [secondChoice.groupIndex]
                : []),
              ...(thirdChoice.slackOnly
                ? [thirdChoice.groupIndex]
                : []),
              ...(fourthChoice.slackOnly
                ? [fourthChoice.groupIndex]
                : []),
              ...(fifthChoice.slackOnly
                ? [fifthChoice.groupIndex]
                : []),
              ...(sixthChoice.slackOnly
                ? [sixthChoice.groupIndex]
                : []),
              ...(seventhChoice.slackOnly
                ? [seventhChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        results.push({
          branchIndex: requested.branchIndex,
          firstChoiceIndex: requested.firstChoiceIndex,
          secondChoiceIndex: requested.secondChoiceIndex,
          thirdChoiceIndex: requested.thirdChoiceIndex,
          fourthChoiceIndex: requested.fourthChoiceIndex,
          fifthChoiceIndex: requested.fifthChoiceIndex,
          sixthChoiceIndex: requested.sixthChoiceIndex,
          seventhChoiceIndex,
          seventhChoiceGroupIndex: seventhChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-seventh-shard-summary]',
      JSON.stringify({
        groupIndex,
        firstSparseCustomer: firstSparse.customerId,
        secondSparseCustomer: secondSparse.customerId,
        thirdSparseCustomer: thirdSparse.customerId,
        fourthSparseCustomer: fourthSparse.customerId,
        fifthSparseCustomer: fifthSparse.customerId,
        sixthSparseCustomer: sixthSparse.customerId,
        seventhSparseCustomer: seventhSparse.customerId,
        seventhSparseCandidateCount: seventhSparse.candidates.length,
        requestedCases,
        totalBranches: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )
    expect(unresolved).toEqual([])
  },
  120000,
)

forcedSixthProfileIt(
  'checks fixed sixth-level sparse-customer shards for a forced identity',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_SIXTH_GROUP,
    )
    expect(Number.isInteger(groupIndex)).toBe(true)
    expect(groups[groupIndex]).toBeDefined()
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    const branchCustomerIds = new Set(
      branchCustomers.map((entry) => entry.customerId),
    )
    const sparseCustomers = residualCustomerIds
      .filter((customerId) => !branchCustomerIds.has(customerId))
      .map((customerId) => ({
        customerId,
        candidates: candidatesForCustomer(customerId),
      }))
      .sort(
        (left, right) =>
          left.candidates.length - right.candidates.length,
      )
    const firstSparse = sparseCustomers[0]
    const secondSparse = sparseCustomers[1]
    const thirdSparse = sparseCustomers[2]
    const fourthSparse = sparseCustomers[3]
    const fifthSparse = sparseCustomers[4]
    const sixthSparse = sparseCustomers[5]
    expect(firstSparse).toBeDefined()
    expect(secondSparse).toBeDefined()
    expect(thirdSparse).toBeDefined()
    expect(fourthSparse).toBeDefined()
    expect(fifthSparse).toBeDefined()
    expect(sixthSparse).toBeDefined()
    if (
      !firstSparse ||
      !secondSparse ||
      !thirdSparse ||
      !fourthSparse ||
      !fifthSparse ||
      !sixthSparse
    ) return

    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
        })),
      )
    }

    const requestedCases =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_SIXTH_CASES ??
        ''
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const [
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
            fourthChoiceIndex,
            fifthChoiceIndex,
          ] = value.split(':').map(Number)
          return {
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
            fourthChoiceIndex,
            fifthChoiceIndex,
          }
        })
        .filter((entry) =>
          Number.isInteger(entry.branchIndex) &&
          entry.branchIndex >= 0 &&
          entry.branchIndex < branches.length &&
          Number.isInteger(entry.firstChoiceIndex) &&
          entry.firstChoiceIndex >= 0 &&
          entry.firstChoiceIndex < firstSparse.candidates.length &&
          Number.isInteger(entry.secondChoiceIndex) &&
          entry.secondChoiceIndex >= 0 &&
          entry.secondChoiceIndex < secondSparse.candidates.length &&
          Number.isInteger(entry.thirdChoiceIndex) &&
          entry.thirdChoiceIndex >= 0 &&
          entry.thirdChoiceIndex < thirdSparse.candidates.length &&
          Number.isInteger(entry.fourthChoiceIndex) &&
          entry.fourthChoiceIndex >= 0 &&
          entry.fourthChoiceIndex < fourthSparse.candidates.length &&
          Number.isInteger(entry.fifthChoiceIndex) &&
          entry.fifthChoiceIndex >= 0 &&
          entry.fifthChoiceIndex < fifthSparse.candidates.length
        )
    expect(requestedCases.length).toBeGreaterThan(0)

    const results = []
    for (const requested of requestedCases) {
      const branch = branches[requested.branchIndex]
      const firstChoice =
        firstSparse.candidates[requested.firstChoiceIndex]
      const secondChoice =
        secondSparse.candidates[requested.secondChoiceIndex]
      const thirdChoice =
        thirdSparse.candidates[requested.thirdChoiceIndex]
      const fourthChoice =
        fourthSparse.candidates[requested.fourthChoiceIndex]
      const fifthChoice =
        fifthSparse.candidates[requested.fifthChoiceIndex]
      for (
        let sixthChoiceIndex = 0;
        sixthChoiceIndex < sixthSparse.candidates.length;
        sixthChoiceIndex += 1
      ) {
        const sixthChoice =
          sixthSparse.candidates[sixthChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              firstChoice.groupIndex,
              secondChoice.groupIndex,
              thirdChoice.groupIndex,
              fourthChoice.groupIndex,
              fifthChoice.groupIndex,
              sixthChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(firstChoice.slackOnly
                ? [firstChoice.groupIndex]
                : []),
              ...(secondChoice.slackOnly
                ? [secondChoice.groupIndex]
                : []),
              ...(thirdChoice.slackOnly
                ? [thirdChoice.groupIndex]
                : []),
              ...(fourthChoice.slackOnly
                ? [fourthChoice.groupIndex]
                : []),
              ...(fifthChoice.slackOnly
                ? [fifthChoice.groupIndex]
                : []),
              ...(sixthChoice.slackOnly
                ? [sixthChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        results.push({
          branchIndex: requested.branchIndex,
          firstChoiceIndex: requested.firstChoiceIndex,
          secondChoiceIndex: requested.secondChoiceIndex,
          thirdChoiceIndex: requested.thirdChoiceIndex,
          fourthChoiceIndex: requested.fourthChoiceIndex,
          fifthChoiceIndex: requested.fifthChoiceIndex,
          sixthChoiceIndex,
          sixthChoiceGroupIndex: sixthChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-sixth-shard-summary]',
      JSON.stringify({
        groupIndex,
        firstSparseCustomer: firstSparse.customerId,
        secondSparseCustomer: secondSparse.customerId,
        thirdSparseCustomer: thirdSparse.customerId,
        fourthSparseCustomer: fourthSparse.customerId,
        fifthSparseCustomer: fifthSparse.customerId,
        sixthSparseCustomer: sixthSparse.customerId,
        sixthSparseCandidateCount: sixthSparse.candidates.length,
        requestedCases,
        totalBranches: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )
    expect(unresolved).toEqual([])
  },
  120000,
)

forcedFifthProfileIt(
  'checks fixed fifth-level sparse-customer shards for a forced identity',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_FIFTH_GROUP,
    )
    expect(Number.isInteger(groupIndex)).toBe(true)
    expect(groups[groupIndex]).toBeDefined()
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    const branchCustomerIds = new Set(
      branchCustomers.map((entry) => entry.customerId),
    )
    const sparseCustomers = residualCustomerIds
      .filter((customerId) => !branchCustomerIds.has(customerId))
      .map((customerId) => ({
        customerId,
        candidates: candidatesForCustomer(customerId),
      }))
      .sort(
        (left, right) =>
          left.candidates.length - right.candidates.length,
      )
    const firstSparse = sparseCustomers[0]
    const secondSparse = sparseCustomers[1]
    const thirdSparse = sparseCustomers[2]
    const fourthSparse = sparseCustomers[3]
    const fifthSparse = sparseCustomers[4]
    expect(firstSparse).toBeDefined()
    expect(secondSparse).toBeDefined()
    expect(thirdSparse).toBeDefined()
    expect(fourthSparse).toBeDefined()
    expect(fifthSparse).toBeDefined()
    if (
      !firstSparse ||
      !secondSparse ||
      !thirdSparse ||
      !fourthSparse ||
      !fifthSparse
    ) return

    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
        })),
      )
    }

    const requestedCases =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_FIFTH_CASES ??
        ''
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const [
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
            fourthChoiceIndex,
          ] = value.split(':').map(Number)
          return {
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
            fourthChoiceIndex,
          }
        })
        .filter((entry) =>
          Number.isInteger(entry.branchIndex) &&
          entry.branchIndex >= 0 &&
          entry.branchIndex < branches.length &&
          Number.isInteger(entry.firstChoiceIndex) &&
          entry.firstChoiceIndex >= 0 &&
          entry.firstChoiceIndex < firstSparse.candidates.length &&
          Number.isInteger(entry.secondChoiceIndex) &&
          entry.secondChoiceIndex >= 0 &&
          entry.secondChoiceIndex < secondSparse.candidates.length &&
          Number.isInteger(entry.thirdChoiceIndex) &&
          entry.thirdChoiceIndex >= 0 &&
          entry.thirdChoiceIndex < thirdSparse.candidates.length &&
          Number.isInteger(entry.fourthChoiceIndex) &&
          entry.fourthChoiceIndex >= 0 &&
          entry.fourthChoiceIndex < fourthSparse.candidates.length
        )
    expect(requestedCases.length).toBeGreaterThan(0)

    const results = []
    for (const requested of requestedCases) {
      const branch = branches[requested.branchIndex]
      const firstChoice =
        firstSparse.candidates[requested.firstChoiceIndex]
      const secondChoice =
        secondSparse.candidates[requested.secondChoiceIndex]
      const thirdChoice =
        thirdSparse.candidates[requested.thirdChoiceIndex]
      const fourthChoice =
        fourthSparse.candidates[requested.fourthChoiceIndex]
      for (
        let fifthChoiceIndex = 0;
        fifthChoiceIndex < fifthSparse.candidates.length;
        fifthChoiceIndex += 1
      ) {
        const fifthChoice =
          fifthSparse.candidates[fifthChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              firstChoice.groupIndex,
              secondChoice.groupIndex,
              thirdChoice.groupIndex,
              fourthChoice.groupIndex,
              fifthChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(firstChoice.slackOnly
                ? [firstChoice.groupIndex]
                : []),
              ...(secondChoice.slackOnly
                ? [secondChoice.groupIndex]
                : []),
              ...(thirdChoice.slackOnly
                ? [thirdChoice.groupIndex]
                : []),
              ...(fourthChoice.slackOnly
                ? [fourthChoice.groupIndex]
                : []),
              ...(fifthChoice.slackOnly
                ? [fifthChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        results.push({
          branchIndex: requested.branchIndex,
          firstChoiceIndex: requested.firstChoiceIndex,
          secondChoiceIndex: requested.secondChoiceIndex,
          thirdChoiceIndex: requested.thirdChoiceIndex,
          fourthChoiceIndex: requested.fourthChoiceIndex,
          fifthChoiceIndex,
          fifthChoiceGroupIndex: fifthChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-fifth-shard-summary]',
      JSON.stringify({
        groupIndex,
        firstSparseCustomer: firstSparse.customerId,
        secondSparseCustomer: secondSparse.customerId,
        thirdSparseCustomer: thirdSparse.customerId,
        fourthSparseCustomer: fourthSparse.customerId,
        fifthSparseCustomer: fifthSparse.customerId,
        fifthSparseCandidateCount: fifthSparse.candidates.length,
        requestedCases,
        totalBranches: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )
    expect(unresolved).toEqual([])
  },
  120000,
)

forcedFourthProfileIt(
  'checks fixed fourth-level sparse-customer shards for a forced identity',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_FOURTH_GROUP,
    )
    expect(Number.isInteger(groupIndex)).toBe(true)
    expect(groups[groupIndex]).toBeDefined()
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    const branchCustomerIds = new Set(
      branchCustomers.map((entry) => entry.customerId),
    )
    const sparseCustomers = residualCustomerIds
      .filter((customerId) => !branchCustomerIds.has(customerId))
      .map((customerId) => ({
        customerId,
        candidates: candidatesForCustomer(customerId),
      }))
      .sort(
        (left, right) =>
          left.candidates.length - right.candidates.length,
      )
    const firstSparse = sparseCustomers[0]
    const secondSparse = sparseCustomers[1]
    const thirdSparse = sparseCustomers[2]
    const fourthSparse = sparseCustomers[3]
    expect(firstSparse).toBeDefined()
    expect(secondSparse).toBeDefined()
    expect(thirdSparse).toBeDefined()
    expect(fourthSparse).toBeDefined()
    if (!firstSparse || !secondSparse || !thirdSparse || !fourthSparse) return

    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
        })),
      )
    }

    const requestedCases =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_FOURTH_CASES ??
        ''
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const [
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
          ] = value.split(':').map(Number)
          return {
            branchIndex,
            firstChoiceIndex,
            secondChoiceIndex,
            thirdChoiceIndex,
          }
        })
        .filter((entry) =>
          Number.isInteger(entry.branchIndex) &&
          entry.branchIndex >= 0 &&
          entry.branchIndex < branches.length &&
          Number.isInteger(entry.firstChoiceIndex) &&
          entry.firstChoiceIndex >= 0 &&
          entry.firstChoiceIndex < firstSparse.candidates.length &&
          Number.isInteger(entry.secondChoiceIndex) &&
          entry.secondChoiceIndex >= 0 &&
          entry.secondChoiceIndex < secondSparse.candidates.length &&
          Number.isInteger(entry.thirdChoiceIndex) &&
          entry.thirdChoiceIndex >= 0 &&
          entry.thirdChoiceIndex < thirdSparse.candidates.length
        )
    expect(requestedCases.length).toBeGreaterThan(0)

    const results = []
    for (const requested of requestedCases) {
      const branch = branches[requested.branchIndex]
      const firstChoice =
        firstSparse.candidates[requested.firstChoiceIndex]
      const secondChoice =
        secondSparse.candidates[requested.secondChoiceIndex]
      const thirdChoice =
        thirdSparse.candidates[requested.thirdChoiceIndex]
      for (
        let fourthChoiceIndex = 0;
        fourthChoiceIndex < fourthSparse.candidates.length;
        fourthChoiceIndex += 1
      ) {
        const fourthChoice =
          fourthSparse.candidates[fourthChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              firstChoice.groupIndex,
              secondChoice.groupIndex,
              thirdChoice.groupIndex,
              fourthChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(firstChoice.slackOnly
                ? [firstChoice.groupIndex]
                : []),
              ...(secondChoice.slackOnly
                ? [secondChoice.groupIndex]
                : []),
              ...(thirdChoice.slackOnly
                ? [thirdChoice.groupIndex]
                : []),
              ...(fourthChoice.slackOnly
                ? [fourthChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        results.push({
          branchIndex: requested.branchIndex,
          firstChoiceIndex: requested.firstChoiceIndex,
          secondChoiceIndex: requested.secondChoiceIndex,
          thirdChoiceIndex: requested.thirdChoiceIndex,
          fourthChoiceIndex,
          fourthChoiceGroupIndex: fourthChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-fourth-shard-summary]',
      JSON.stringify({
        groupIndex,
        firstSparseCustomer: firstSparse.customerId,
        secondSparseCustomer: secondSparse.customerId,
        thirdSparseCustomer: thirdSparse.customerId,
        fourthSparseCustomer: fourthSparse.customerId,
        fourthSparseCandidateCount: fourthSparse.candidates.length,
        requestedCases,
        totalBranches: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )
    expect(unresolved).toEqual([])
  },
  120000,
)

forcedThirdProfileIt(
  'checks fixed third-level sparse-customer shards for a forced identity',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_THIRD_GROUP,
    )
    expect(Number.isInteger(groupIndex)).toBe(true)
    expect(groups[groupIndex]).toBeDefined()
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    const branchCustomerIds = new Set(
      branchCustomers.map((entry) => entry.customerId),
    )
    const sparseCustomers = residualCustomerIds
      .filter((customerId) => !branchCustomerIds.has(customerId))
      .map((customerId) => ({
        customerId,
        candidates: candidatesForCustomer(customerId),
      }))
      .sort(
        (left, right) =>
          left.candidates.length - right.candidates.length,
      )
    const firstSparse = sparseCustomers[0]
    const secondSparse = sparseCustomers[1]
    const thirdSparse = sparseCustomers[2]
    expect(firstSparse).toBeDefined()
    expect(secondSparse).toBeDefined()
    expect(thirdSparse).toBeDefined()
    if (!firstSparse || !secondSparse || !thirdSparse) return

    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
        })),
      )
    }

    const requestedCases =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_THIRD_CASES ??
        ''
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const [branchIndex, firstChoiceIndex, secondChoiceIndex] =
            value.split(':').map(Number)
          return { branchIndex, firstChoiceIndex, secondChoiceIndex }
        })
        .filter((entry) =>
          Number.isInteger(entry.branchIndex) &&
          entry.branchIndex >= 0 &&
          entry.branchIndex < branches.length &&
          Number.isInteger(entry.firstChoiceIndex) &&
          entry.firstChoiceIndex >= 0 &&
          entry.firstChoiceIndex < firstSparse.candidates.length &&
          Number.isInteger(entry.secondChoiceIndex) &&
          entry.secondChoiceIndex >= 0 &&
          entry.secondChoiceIndex < secondSparse.candidates.length
        )
    expect(requestedCases.length).toBeGreaterThan(0)

    const results = []
    for (const requested of requestedCases) {
      const branch = branches[requested.branchIndex]
      const firstChoice =
        firstSparse.candidates[requested.firstChoiceIndex]
      const secondChoice =
        secondSparse.candidates[requested.secondChoiceIndex]
      for (
        let thirdChoiceIndex = 0;
        thirdChoiceIndex < thirdSparse.candidates.length;
        thirdChoiceIndex += 1
      ) {
        const thirdChoice =
          thirdSparse.candidates[thirdChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              firstChoice.groupIndex,
              secondChoice.groupIndex,
              thirdChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(firstChoice.slackOnly
                ? [firstChoice.groupIndex]
                : []),
              ...(secondChoice.slackOnly
                ? [secondChoice.groupIndex]
                : []),
              ...(thirdChoice.slackOnly
                ? [thirdChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        results.push({
          branchIndex: requested.branchIndex,
          firstChoiceIndex: requested.firstChoiceIndex,
          secondChoiceIndex: requested.secondChoiceIndex,
          thirdChoiceIndex,
          thirdChoiceGroupIndex: thirdChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-third-shard-summary]',
      JSON.stringify({
        groupIndex,
        firstSparseCustomer: firstSparse.customerId,
        secondSparseCustomer: secondSparse.customerId,
        thirdSparseCustomer: thirdSparse.customerId,
        thirdSparseCandidateCount: thirdSparse.candidates.length,
        requestedCases,
        totalBranches: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )
    expect(unresolved).toEqual([])
  },
  120000,
)

forcedDeepProfileIt(
  'refines selected forced-customer base branches by next sparse customer',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_DEEP_GROUP,
    )
    expect(Number.isInteger(groupIndex)).toBe(true)
    expect(groups[groupIndex]).toBeDefined()
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    const branchCustomerIds = new Set(
      branchCustomers.map((entry) => entry.customerId),
    )
    const nextSparseCustomers = residualCustomerIds
      .filter((customerId) => !branchCustomerIds.has(customerId))
      .map((customerId) => ({
        customerId,
        candidates: candidatesForCustomer(customerId),
      }))
      .sort(
        (left, right) =>
          left.candidates.length - right.candidates.length,
      )
    const nextSparse = nextSparseCustomers[0]
    expect(nextSparse).toBeDefined()
    if (!nextSparse) return

    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
      choices: Array<{ customerId: string; groupIndex: number }>
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
      choices: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
          choices: [
            ...branch.choices,
            {
              customerId: branchCustomer.customerId,
              groupIndex: candidate.groupIndex,
            },
          ],
        })),
      )
    }

    const requestedBranches =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_FORCED_DEEP_BRANCHES ??
        ''
      )
        .split(',')
        .map((value) => Number(value.trim()))
        .filter(
          (value) =>
            Number.isInteger(value) &&
            value >= 0 &&
            value < branches.length,
        )
    expect(requestedBranches.length).toBeGreaterThan(0)

    const results = []
    for (const branchIndex of requestedBranches) {
      const branch = branches[branchIndex]
      for (
        let choiceIndex = 0;
        choiceIndex < nextSparse.candidates.length;
        choiceIndex += 1
      ) {
        const choice = nextSparse.candidates[choiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              choice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(choice.slackOnly ? [choice.groupIndex] : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        results.push({
          branchIndex,
          choiceIndex,
          choiceGroupIndex: choice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-deep-summary]',
      JSON.stringify({
        groupIndex,
        requestedBranches,
        nextSparseCustomer: nextSparse.customerId,
        nextSparseCandidateCount: nextSparse.candidates.length,
        totalBranches: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )

    const secondSparse = nextSparseCustomers[1]
    expect(secondSparse).toBeDefined()
    if (!secondSparse) return
    const secondResults = []
    for (const parent of unresolved) {
      const branch = branches[parent.branchIndex]
      const firstChoice =
        nextSparse.candidates[parent.choiceIndex]
      for (
        let secondChoiceIndex = 0;
        secondChoiceIndex < secondSparse.candidates.length;
        secondChoiceIndex += 1
      ) {
        const secondChoice =
          secondSparse.candidates[secondChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              firstChoice.groupIndex,
              secondChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(firstChoice.slackOnly
                ? [firstChoice.groupIndex]
                : []),
              ...(secondChoice.slackOnly
                ? [secondChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        secondResults.push({
          branchIndex: parent.branchIndex,
          firstChoiceIndex: parent.choiceIndex,
          firstChoiceGroupIndex: firstChoice.groupIndex,
          secondChoiceIndex,
          secondChoiceGroupIndex: secondChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolvedSecond = secondResults.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-deep-second-summary]',
      JSON.stringify({
        groupIndex,
        parentBranches: unresolved.length,
        secondSparseCustomer: secondSparse.customerId,
        secondSparseCandidateCount: secondSparse.candidates.length,
        totalBranches: secondResults.length,
        infeasibleCount:
          secondResults.length - unresolvedSecond.length,
        unresolvedCount: unresolvedSecond.length,
        unresolved: unresolvedSecond,
      }),
    )

    const thirdSparse = nextSparseCustomers[2]
    expect(thirdSparse).toBeDefined()
    if (!thirdSparse) return
    const thirdResults = []
    for (const parent of unresolvedSecond) {
      const branch = branches[parent.branchIndex]
      const firstChoice =
        nextSparse.candidates[parent.firstChoiceIndex]
      const secondChoice =
        secondSparse.candidates[parent.secondChoiceIndex]
      for (
        let thirdChoiceIndex = 0;
        thirdChoiceIndex < thirdSparse.candidates.length;
        thirdChoiceIndex += 1
      ) {
        const thirdChoice =
          thirdSparse.candidates[thirdChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              firstChoice.groupIndex,
              secondChoice.groupIndex,
              thirdChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(firstChoice.slackOnly
                ? [firstChoice.groupIndex]
                : []),
              ...(secondChoice.slackOnly
                ? [secondChoice.groupIndex]
                : []),
              ...(thirdChoice.slackOnly
                ? [thirdChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        thirdResults.push({
          branchIndex: parent.branchIndex,
          firstChoiceIndex: parent.firstChoiceIndex,
          firstChoiceGroupIndex: firstChoice.groupIndex,
          secondChoiceIndex: parent.secondChoiceIndex,
          secondChoiceGroupIndex: secondChoice.groupIndex,
          thirdChoiceIndex,
          thirdChoiceGroupIndex: thirdChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolvedThird = thirdResults.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-deep-third-summary]',
      JSON.stringify({
        groupIndex,
        parentBranches: unresolvedSecond.length,
        thirdSparseCustomer: thirdSparse.customerId,
        thirdSparseCandidateCount: thirdSparse.candidates.length,
        totalBranches: thirdResults.length,
        infeasibleCount:
          thirdResults.length - unresolvedThird.length,
        unresolvedCount: unresolvedThird.length,
        unresolved: unresolvedThird,
      }),
    )
    expect(unresolvedThird).toEqual([])
  },
  120000,
)

forcedBaseProfileIt(
  'checks exact low-degree base covers for one forced-customer identity',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = Number(
      machineContinuationEnv.MACHINE_CONTINUATION_FORCED_BASE_GROUP,
    )
    expect(Number.isInteger(groupIndex)).toBe(true)
    expect(groups[groupIndex]).toBeDefined()
    expect(groups[groupIndex].eligibleCustomerIds.length).toBe(8)

    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )

    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    expect(branchCustomers.length).toBeGreaterThan(0)

    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
      choices: Array<{ customerId: string; groupIndex: number }>
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
      choices: [],
    }]
    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
          choices: [
            ...branch.choices,
            {
              customerId: branchCustomer.customerId,
              groupIndex: candidate.groupIndex,
            },
          ],
        })),
      )
    }

    const results = []
    for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
      const branch = branches[branchIndex]
      const built = build311ExtraCostSumSupportMaster(
        domain,
        groupIndex,
        undefined,
        {
          includeCustomerFlow: true,
          forcedCustomerIds:
            groups[groupIndex].eligibleCustomerIds,
          requiredUsedGroupIndexes:
            branch.requiredUsedGroupIndexes,
          requiredSlackGroupIndexes:
            branch.requiredSlackGroupIndexes,
        },
      )
      const solved = await solveBounded(built.model, 0.5)
      results.push({
        branchIndex,
        choices: branch.choices,
        status: solved.status,
        solveMs: Math.round(solved.solveMs),
      })
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-forced-base-cover-summary]',
      JSON.stringify({
        groupIndex,
        groupCost: groups[groupIndex].ingredientCost,
        branchCustomers: branchCustomers.map((entry) => ({
          customerId: entry.customerId,
          candidateCount: entry.candidates.length,
        })),
        totalBranches: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )
  },
  120000,
)

patriciaShardProfileIt(
  'checks sharded exact Hugo + Patricia branches for identity 1279',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = 1279
    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )

    const candidatesForCustomer = (customerId: string) =>
      groups.flatMap((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return []
        const residualEligible = group.eligibleCustomerIds.filter(
          (eligibleCustomerId) =>
            !fixedCustomers.has(eligibleCustomerId),
        )
        if (!residualEligible.includes(customerId)) return []
        const normal = residualEligible.length >= 2
        const slack =
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        return normal || slack
          ? [{
              groupIndex: candidateGroupIndex,
              slackOnly: !normal && slack,
            }]
          : []
      })

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = candidatesForCustomer(customerId)
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )
    expect(branchCustomers.length).toBe(4)

    let baseBranches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
      choices: Array<{ customerId: string; groupIndex: number }>
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
      choices: [],
    }]
    for (const branchCustomer of branchCustomers) {
      baseBranches = baseBranches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
          choices: [
            ...branch.choices,
            {
              customerId: branchCustomer.customerId,
              groupIndex: candidate.groupIndex,
            },
          ],
        })),
      )
    }
    expect(baseBranches.length).toBe(24)

    const hugoCandidates = candidatesForCustomer('hugo')
    const patriciaCandidates = candidatesForCustomer('patricia')
    const tiffanyCandidates = candidatesForCustomer('tiffany')
    const solomonCandidates = candidatesForCustomer('solomon')
    const dominicCandidates = candidatesForCustomer('dominic')
    const heloiseCandidates = candidatesForCustomer('heloise')
    expect(hugoCandidates.length).toBe(5)
    expect(patriciaCandidates.length).toBe(6)
    expect(tiffanyCandidates.length).toBe(7)
    expect(solomonCandidates.length).toBe(8)
    expect(dominicCandidates.length).toBe(8)
    expect(heloiseCandidates.length).toBe(8)

    const requestedBaseBranches =
      (
        machineContinuationEnv.MACHINE_CONTINUATION_1279_BASE_BRANCHES ??
        ''
      )
        .split(',')
        .map((value) => Number(value.trim()))
        .filter(
          (value) =>
            Number.isInteger(value) &&
            value >= 0 &&
            value < baseBranches.length,
        )
    expect(requestedBaseBranches.length).toBeGreaterThan(0)

    const results = []
    for (const branchIndex of requestedBaseBranches) {
      const branch = baseBranches[branchIndex]
      for (
        let hugoChoiceIndex = 0;
        hugoChoiceIndex < hugoCandidates.length;
        hugoChoiceIndex += 1
      ) {
        const hugoChoice = hugoCandidates[hugoChoiceIndex]
        for (
          let patriciaChoiceIndex = 0;
          patriciaChoiceIndex < patriciaCandidates.length;
          patriciaChoiceIndex += 1
        ) {
          const patriciaChoice =
            patriciaCandidates[patriciaChoiceIndex]
          const built = build311ExtraCostSumSupportMaster(
            domain,
            groupIndex,
            undefined,
            {
              includeCustomerFlow: true,
              forcedCustomerIds:
                groups[groupIndex].eligibleCustomerIds,
              requiredUsedGroupIndexes: [
                ...branch.requiredUsedGroupIndexes,
                hugoChoice.groupIndex,
                patriciaChoice.groupIndex,
              ],
              requiredSlackGroupIndexes: [
                ...branch.requiredSlackGroupIndexes,
                ...(hugoChoice.slackOnly
                  ? [hugoChoice.groupIndex]
                  : []),
                ...(patriciaChoice.slackOnly
                  ? [patriciaChoice.groupIndex]
                  : []),
              ],
            },
          )
          const solved = await solveBounded(built.model, 0.5)
          results.push({
            branchIndex,
            hugoChoiceIndex,
            hugoGroupIndex: hugoChoice.groupIndex,
            patriciaChoiceIndex,
            patriciaGroupIndex: patriciaChoice.groupIndex,
            status: solved.status,
            solveMs: Math.round(solved.solveMs),
          })
        }
      }
    }

    const unresolved = results.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-1279-patricia-shard-summary]',
      JSON.stringify({
        requestedBaseBranches,
        totalBranches: results.length,
        infeasibleCount: results.length - unresolved.length,
        unresolvedCount: unresolved.length,
        unresolved,
      }),
    )

    const tiffanyResults = []
    for (const parent of unresolved) {
      const branch = baseBranches[parent.branchIndex]
      const hugoChoice = hugoCandidates[parent.hugoChoiceIndex]
      const patriciaChoice =
        patriciaCandidates[parent.patriciaChoiceIndex]
      for (
        let tiffanyChoiceIndex = 0;
        tiffanyChoiceIndex < tiffanyCandidates.length;
        tiffanyChoiceIndex += 1
      ) {
        const tiffanyChoice =
          tiffanyCandidates[tiffanyChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              hugoChoice.groupIndex,
              patriciaChoice.groupIndex,
              tiffanyChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(hugoChoice.slackOnly
                ? [hugoChoice.groupIndex]
                : []),
              ...(patriciaChoice.slackOnly
                ? [patriciaChoice.groupIndex]
                : []),
              ...(tiffanyChoice.slackOnly
                ? [tiffanyChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        tiffanyResults.push({
          branchIndex: parent.branchIndex,
          hugoChoiceIndex: parent.hugoChoiceIndex,
          hugoGroupIndex: hugoChoice.groupIndex,
          patriciaChoiceIndex: parent.patriciaChoiceIndex,
          patriciaGroupIndex: patriciaChoice.groupIndex,
          tiffanyChoiceIndex,
          tiffanyGroupIndex: tiffanyChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolvedTiffany = tiffanyResults.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-1279-tiffany-shard-summary]',
      JSON.stringify({
        requestedBaseBranches,
        parentBranches: unresolved.length,
        totalBranches: tiffanyResults.length,
        infeasibleCount:
          tiffanyResults.length - unresolvedTiffany.length,
        unresolvedCount: unresolvedTiffany.length,
        unresolved: unresolvedTiffany,
      }),
    )

    const solomonResults = []
    for (const parent of unresolvedTiffany) {
      const branch = baseBranches[parent.branchIndex]
      const hugoChoice = hugoCandidates[parent.hugoChoiceIndex]
      const patriciaChoice =
        patriciaCandidates[parent.patriciaChoiceIndex]
      const tiffanyChoice =
        tiffanyCandidates[parent.tiffanyChoiceIndex]
      for (
        let solomonChoiceIndex = 0;
        solomonChoiceIndex < solomonCandidates.length;
        solomonChoiceIndex += 1
      ) {
        const solomonChoice =
          solomonCandidates[solomonChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              hugoChoice.groupIndex,
              patriciaChoice.groupIndex,
              tiffanyChoice.groupIndex,
              solomonChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(hugoChoice.slackOnly
                ? [hugoChoice.groupIndex]
                : []),
              ...(patriciaChoice.slackOnly
                ? [patriciaChoice.groupIndex]
                : []),
              ...(tiffanyChoice.slackOnly
                ? [tiffanyChoice.groupIndex]
                : []),
              ...(solomonChoice.slackOnly
                ? [solomonChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        solomonResults.push({
          branchIndex: parent.branchIndex,
          hugoChoiceIndex: parent.hugoChoiceIndex,
          patriciaChoiceIndex: parent.patriciaChoiceIndex,
          tiffanyChoiceIndex: parent.tiffanyChoiceIndex,
          solomonChoiceIndex,
          solomonGroupIndex: solomonChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolvedSolomon = solomonResults.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-1279-solomon-shard-summary]',
      JSON.stringify({
        requestedBaseBranches,
        parentBranches: unresolvedTiffany.length,
        totalBranches: solomonResults.length,
        infeasibleCount:
          solomonResults.length - unresolvedSolomon.length,
        unresolvedCount: unresolvedSolomon.length,
        unresolved: unresolvedSolomon,
      }),
    )

    const dominicResults = []
    for (const parent of unresolvedSolomon) {
      const branch = baseBranches[parent.branchIndex]
      const hugoChoice = hugoCandidates[parent.hugoChoiceIndex]
      const patriciaChoice =
        patriciaCandidates[parent.patriciaChoiceIndex]
      const tiffanyChoice =
        tiffanyCandidates[parent.tiffanyChoiceIndex]
      const solomonChoice =
        solomonCandidates[parent.solomonChoiceIndex]
      for (
        let dominicChoiceIndex = 0;
        dominicChoiceIndex < dominicCandidates.length;
        dominicChoiceIndex += 1
      ) {
        const dominicChoice =
          dominicCandidates[dominicChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              hugoChoice.groupIndex,
              patriciaChoice.groupIndex,
              tiffanyChoice.groupIndex,
              solomonChoice.groupIndex,
              dominicChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(hugoChoice.slackOnly
                ? [hugoChoice.groupIndex]
                : []),
              ...(patriciaChoice.slackOnly
                ? [patriciaChoice.groupIndex]
                : []),
              ...(tiffanyChoice.slackOnly
                ? [tiffanyChoice.groupIndex]
                : []),
              ...(solomonChoice.slackOnly
                ? [solomonChoice.groupIndex]
                : []),
              ...(dominicChoice.slackOnly
                ? [dominicChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        dominicResults.push({
          branchIndex: parent.branchIndex,
          hugoChoiceIndex: parent.hugoChoiceIndex,
          patriciaChoiceIndex: parent.patriciaChoiceIndex,
          tiffanyChoiceIndex: parent.tiffanyChoiceIndex,
          solomonChoiceIndex: parent.solomonChoiceIndex,
          dominicChoiceIndex,
          dominicGroupIndex: dominicChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolvedDominic = dominicResults.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-1279-dominic-shard-summary]',
      JSON.stringify({
        requestedBaseBranches,
        parentBranches: unresolvedSolomon.length,
        totalBranches: dominicResults.length,
        infeasibleCount:
          dominicResults.length - unresolvedDominic.length,
        unresolvedCount: unresolvedDominic.length,
        unresolved: unresolvedDominic,
      }),
    )

    const heloiseResults = []
    for (const parent of unresolvedDominic) {
      const branch = baseBranches[parent.branchIndex]
      const hugoChoice = hugoCandidates[parent.hugoChoiceIndex]
      const patriciaChoice =
        patriciaCandidates[parent.patriciaChoiceIndex]
      const tiffanyChoice =
        tiffanyCandidates[parent.tiffanyChoiceIndex]
      const solomonChoice =
        solomonCandidates[parent.solomonChoiceIndex]
      const dominicChoice =
        dominicCandidates[parent.dominicChoiceIndex]
      for (
        let heloiseChoiceIndex = 0;
        heloiseChoiceIndex < heloiseCandidates.length;
        heloiseChoiceIndex += 1
      ) {
        const heloiseChoice =
          heloiseCandidates[heloiseChoiceIndex]
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            includeCustomerFlow: true,
            forcedCustomerIds:
              groups[groupIndex].eligibleCustomerIds,
            requiredUsedGroupIndexes: [
              ...branch.requiredUsedGroupIndexes,
              hugoChoice.groupIndex,
              patriciaChoice.groupIndex,
              tiffanyChoice.groupIndex,
              solomonChoice.groupIndex,
              dominicChoice.groupIndex,
              heloiseChoice.groupIndex,
            ],
            requiredSlackGroupIndexes: [
              ...branch.requiredSlackGroupIndexes,
              ...(hugoChoice.slackOnly
                ? [hugoChoice.groupIndex]
                : []),
              ...(patriciaChoice.slackOnly
                ? [patriciaChoice.groupIndex]
                : []),
              ...(tiffanyChoice.slackOnly
                ? [tiffanyChoice.groupIndex]
                : []),
              ...(solomonChoice.slackOnly
                ? [solomonChoice.groupIndex]
                : []),
              ...(dominicChoice.slackOnly
                ? [dominicChoice.groupIndex]
                : []),
              ...(heloiseChoice.slackOnly
                ? [heloiseChoice.groupIndex]
                : []),
            ],
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        heloiseResults.push({
          branchIndex: parent.branchIndex,
          hugoChoiceIndex: parent.hugoChoiceIndex,
          patriciaChoiceIndex: parent.patriciaChoiceIndex,
          tiffanyChoiceIndex: parent.tiffanyChoiceIndex,
          solomonChoiceIndex: parent.solomonChoiceIndex,
          dominicChoiceIndex: parent.dominicChoiceIndex,
          heloiseChoiceIndex,
          heloiseGroupIndex: heloiseChoice.groupIndex,
          status: solved.status,
          solveMs: Math.round(solved.solveMs),
        })
      }
    }

    const unresolvedHeloise = heloiseResults.filter(
      (entry) => entry.status !== 'infeasible',
    )
    console.info(
      '[machine-1279-heloise-shard-summary]',
      JSON.stringify({
        requestedBaseBranches,
        parentBranches: unresolvedDominic.length,
        totalBranches: heloiseResults.length,
        infeasibleCount:
          heloiseResults.length - unresolvedHeloise.length,
        unresolvedCount: unresolvedHeloise.length,
        unresolved: unresolvedHeloise,
      }),
    )
    expect(unresolvedHeloise).toEqual([])
  },
  120000,
)

forcedResidualProfileIt(
  'profiles forced-customer residual graph structure',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const targetGroupIndexes = [
      187, 223, 247, 307, 344, 457, 609, 666, 1279,
    ] as const
    const results = []

    for (const groupIndex of targetGroupIndexes) {
      const fixedCustomers = new Set(
        groups[groupIndex].eligibleCustomerIds,
      )
      const residualCustomerIds =
        domain.serviceableCustomerIds.filter(
          (customerId) => !fixedCustomers.has(customerId),
        )
      const residualMaskCustomerIds = new Map<string, string[]>()
      let normalCandidateCount = 0
      let extraCandidateCount = 0
      let slackCandidateCount = 0
      const customerNeighborCounts = new Map(
        residualCustomerIds.map((customerId) => [customerId, 0]),
      )

      groups.forEach((group, candidateGroupIndex) => {
        if (candidateGroupIndex === groupIndex) return
        const residualEligible = group.eligibleCustomerIds.filter(
          (customerId) => !fixedCustomers.has(customerId),
        )
        const key = residualEligible.join('\u001e')
        if (!residualMaskCustomerIds.has(key)) {
          residualMaskCustomerIds.set(key, residualEligible)
        }
        if (residualEligible.length >= 2) {
          normalCandidateCount += 1
          for (const customerId of residualEligible) {
            customerNeighborCounts.set(
              customerId,
              (customerNeighborCounts.get(customerId) ?? 0) + 1,
            )
          }
        }
        if (residualEligible.length >= 4) extraCandidateCount += 1
        if (
          group.ingredientCost === SLACK_RECIPE_COST &&
          residualEligible.length >= 1
        ) {
          slackCandidateCount += 1
        }
      })

      const customerTypes = customerMaskFlowTypes(
        residualCustomerIds,
        residualMaskCustomerIds,
      )
      const degrees = [...customerNeighborCounts.values()].sort(
        (left, right) => left - right,
      )
      const lowDegreeCustomers = residualCustomerIds.flatMap(
        (customerId) => {
          const candidates = groups.flatMap((group, candidateGroupIndex) => {
            if (candidateGroupIndex === groupIndex) return []
            const residualEligible = group.eligibleCustomerIds.filter(
              (eligibleCustomerId) =>
                !fixedCustomers.has(eligibleCustomerId),
            )
            const canServeNormally =
              residualEligible.length >= 2 &&
              residualEligible.includes(customerId)
            const canServeAsSlack =
              group.ingredientCost === SLACK_RECIPE_COST &&
              residualEligible.length >= 1 &&
              residualEligible.includes(customerId)
            return canServeNormally || canServeAsSlack
              ? [{
                  groupIndex: candidateGroupIndex,
                  cost: group.ingredientCost,
                  normal: canServeNormally,
                  slack: canServeAsSlack,
                  residualEligible: residualEligible.length,
                }]
              : []
          })
          return candidates.length <= 3
            ? [{ customerId, candidates }]
            : []
        },
      )
      results.push({
        groupIndex,
        groupCost: groups[groupIndex].ingredientCost,
        residualCustomers: residualCustomerIds.length,
        residualMaskCount: residualMaskCustomerIds.size,
        customerTypeCount: customerTypes.length,
        multiCustomerTypes: customerTypes.filter(
          (entry) => entry.customerIds.length > 1,
        ).map((entry) => ({
          demand: entry.customerIds.length,
          neighborMasks: entry.neighborMaskKeys.length,
        })),
        normalCandidateCount,
        extraCandidateCount,
        slackCandidateCount,
        minCustomerNeighborGroups: degrees[0] ?? 0,
        p10CustomerNeighborGroups:
          degrees[Math.floor(degrees.length * 0.1)] ?? 0,
        medianCustomerNeighborGroups:
          degrees[Math.floor(degrees.length * 0.5)] ?? 0,
        maxCustomerNeighborGroups:
          degrees[degrees.length - 1] ?? 0,
        lowDegreeCustomers,
      })
    }

    console.info(
      '[machine-forced-residual-structure-summary]',
      JSON.stringify(results),
    )
  },
  120000,
)

forcedResidualProfileIt(
  'branches exact low-degree residual customer covers for identity 1279',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = 1279
    const fixedCustomers = new Set(
      groups[groupIndex].eligibleCustomerIds,
    )
    const residualCustomerIds =
      domain.serviceableCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )

    const branchCustomers = residualCustomerIds.flatMap(
      (customerId) => {
        const candidates = groups.flatMap((group, candidateGroupIndex) => {
          if (candidateGroupIndex === groupIndex) return []
          const residualEligible = group.eligibleCustomerIds.filter(
            (eligibleCustomerId) =>
              !fixedCustomers.has(eligibleCustomerId),
          )
          if (!residualEligible.includes(customerId)) return []
          const normal = residualEligible.length >= 2
          const slack =
            group.ingredientCost === SLACK_RECIPE_COST &&
            residualEligible.length >= 1
          return normal || slack
            ? [{
                groupIndex: candidateGroupIndex,
                slackOnly: !normal && slack,
              }]
            : []
        })
        return candidates.length <= 3
          ? [{ customerId, candidates }]
          : []
      },
    )

    const branchCustomerIds = new Set(
      branchCustomers.map((entry) => entry.customerId),
    )
    const nextSparseCustomers = residualCustomerIds
      .filter((customerId) => !branchCustomerIds.has(customerId))
      .map((customerId) => {
        const candidates = groups.flatMap((group, candidateGroupIndex) => {
          if (candidateGroupIndex === groupIndex) return []
          const residualEligible = group.eligibleCustomerIds.filter(
            (eligibleCustomerId) =>
              !fixedCustomers.has(eligibleCustomerId),
          )
          if (!residualEligible.includes(customerId)) return []
          const normal = residualEligible.length >= 2
          const slack =
            group.ingredientCost === SLACK_RECIPE_COST &&
            residualEligible.length >= 1
          return normal || slack
            ? [{
                groupIndex: candidateGroupIndex,
                cost: group.ingredientCost,
                slackOnly: !normal && slack,
              }]
            : []
        })
        return { customerId, candidates }
      })
      .sort(
        (left, right) =>
          left.candidates.length - right.candidates.length,
      )
      .slice(0, 6)

    console.info(
      '[machine-forced-residual-next-sparse]',
      JSON.stringify(nextSparseCustomers),
    )

    let branches: Array<{
      requiredUsedGroupIndexes: number[]
      requiredSlackGroupIndexes: number[]
      choices: Array<{ customerId: string; groupIndex: number }>
    }> = [{
      requiredUsedGroupIndexes: [],
      requiredSlackGroupIndexes: [],
      choices: [],
    }]

    for (const branchCustomer of branchCustomers) {
      branches = branches.flatMap((branch) =>
        branchCustomer.candidates.map((candidate) => ({
          requiredUsedGroupIndexes: [
            ...branch.requiredUsedGroupIndexes,
            candidate.groupIndex,
          ],
          requiredSlackGroupIndexes: candidate.slackOnly
            ? [...branch.requiredSlackGroupIndexes, candidate.groupIndex]
            : branch.requiredSlackGroupIndexes,
          choices: [
            ...branch.choices,
            {
              customerId: branchCustomer.customerId,
              groupIndex: candidate.groupIndex,
            },
          ],
        })),
      )
    }

    console.info(
      '[machine-forced-residual-branch-shape]',
      JSON.stringify({
        groupIndex,
        branchCustomerCount: branchCustomers.length,
        branchCount: branches.length,
      }),
    )

    const hugo = nextSparseCustomers.find(
      (entry) => entry.customerId === 'hugo',
    )
    const octavius8Branches = branches
      .map((branch, branchIndex) => ({ branch, branchIndex }))
      .filter(({ branch }) =>
        branch.choices.some(
          (choice) =>
            choice.customerId === 'octavius' &&
            choice.groupIndex === 8,
        ),
      )
    const octavius30Branches = branches
      .map((branch, branchIndex) => ({ branch, branchIndex }))
      .filter(({ branch }) =>
        branch.choices.some(
          (choice) =>
            choice.customerId === 'octavius' &&
            choice.groupIndex === 30,
        ),
      )
    const hugoResults = []
    if (hugo) {
      for (const { branch, branchIndex } of [
        ...octavius8Branches,
        ...octavius30Branches,
      ]) {
        for (
          let hugoChoiceIndex = 0;
          hugoChoiceIndex < hugo.candidates.length;
          hugoChoiceIndex += 1
        ) {
          const hugoChoice = hugo.candidates[hugoChoiceIndex]
          const built = build311ExtraCostSumSupportMaster(
            domain,
            groupIndex,
            undefined,
            {
              includeCustomerFlow: true,
              forcedCustomerIds:
                groups[groupIndex].eligibleCustomerIds,
              requiredUsedGroupIndexes: [
                ...branch.requiredUsedGroupIndexes,
                hugoChoice.groupIndex,
              ],
              requiredSlackGroupIndexes: hugoChoice.slackOnly
                ? [
                    ...branch.requiredSlackGroupIndexes,
                    hugoChoice.groupIndex,
                  ]
                : branch.requiredSlackGroupIndexes,
            },
          )
          const solved = await solveBounded(built.model, 0.5)
          hugoResults.push({
            branchIndex,
            hugoChoiceIndex,
            hugoGroupIndex: hugoChoice.groupIndex,
            status: solved.status,
            solveMs: Math.round(solved.solveMs),
          })
        }
      }
    }

    console.info(
      '[machine-forced-residual-hugo-summary]',
      JSON.stringify({
        parentBranchCount:
          octavius8Branches.length + octavius30Branches.length,
        octavius8ParentBranches: octavius8Branches.length,
        octavius30ParentBranches: octavius30Branches.length,
        hugoChoiceCount: hugo?.candidates.length ?? 0,
        totalBranches: hugoResults.length,
        infeasibleCount: hugoResults.filter(
          (entry) => entry.status === 'infeasible',
        ).length,
        optimalCount: hugoResults.filter(
          (entry) => entry.status === 'optimal',
        ).length,
        unresolvedCount: hugoResults.filter(
          (entry) =>
            entry.status !== 'infeasible' &&
            entry.status !== 'optimal',
        ).length,
        unresolvedParentBranches: [
          ...new Set(
            hugoResults
              .filter(
                (entry) =>
                  entry.status !== 'infeasible',
              )
              .map((entry) => entry.branchIndex),
          ),
        ],
        results: hugoResults,
      }),
    )

    const patricia = nextSparseCustomers.find(
      (entry) => entry.customerId === 'patricia',
    )
    const unresolvedHugoResults = hugoResults.filter(
      (entry) =>
        entry.status !== 'infeasible' &&
        entry.status !== 'optimal',
    )
    const patriciaResults = []
    if (hugo && patricia) {
      for (const unresolved of unresolvedHugoResults) {
        const parent = branches[unresolved.branchIndex]
        const hugoChoice =
          hugo.candidates[unresolved.hugoChoiceIndex]
        for (
          let patriciaChoiceIndex = 0;
          patriciaChoiceIndex < patricia.candidates.length;
          patriciaChoiceIndex += 1
        ) {
          const patriciaChoice =
            patricia.candidates[patriciaChoiceIndex]
          const built = build311ExtraCostSumSupportMaster(
            domain,
            groupIndex,
            undefined,
            {
              includeCustomerFlow: true,
              forcedCustomerIds:
                groups[groupIndex].eligibleCustomerIds,
              requiredUsedGroupIndexes: [
                ...parent.requiredUsedGroupIndexes,
                hugoChoice.groupIndex,
                patriciaChoice.groupIndex,
              ],
              requiredSlackGroupIndexes: [
                ...parent.requiredSlackGroupIndexes,
                ...(hugoChoice.slackOnly
                  ? [hugoChoice.groupIndex]
                  : []),
                ...(patriciaChoice.slackOnly
                  ? [patriciaChoice.groupIndex]
                  : []),
              ],
            },
          )
          const solved = await solveBounded(built.model, 0.5)
          patriciaResults.push({
            branchIndex: unresolved.branchIndex,
            hugoChoiceIndex: unresolved.hugoChoiceIndex,
            hugoGroupIndex: hugoChoice.groupIndex,
            patriciaChoiceIndex,
            patriciaGroupIndex: patriciaChoice.groupIndex,
            status: solved.status,
            solveMs: Math.round(solved.solveMs),
          })
        }
      }
    }

    const unresolvedPatriciaKeys = new Set(
      patriciaResults
        .filter((entry) => entry.status !== 'infeasible')
        .map(
          (entry) =>
            `${entry.branchIndex}|${entry.hugoChoiceIndex}`,
        ),
    )
    const identityClosed =
      hugoResults.every((entry) => {
        if (entry.status === 'infeasible') return true
        if (entry.status === 'optimal') return false
        return !unresolvedPatriciaKeys.has(
          `${entry.branchIndex}|${entry.hugoChoiceIndex}`,
        )
      })

    console.info(
      '[machine-forced-residual-patricia-summary]',
      JSON.stringify({
        unresolvedHugoBranches: unresolvedHugoResults.length,
        patriciaChoiceCount: patricia?.candidates.length ?? 0,
        totalBranches: patriciaResults.length,
        infeasibleCount: patriciaResults.filter(
          (entry) => entry.status === 'infeasible',
        ).length,
        optimalCount: patriciaResults.filter(
          (entry) => entry.status === 'optimal',
        ).length,
        unresolvedCount: patriciaResults.filter(
          (entry) =>
            entry.status !== 'infeasible' &&
            entry.status !== 'optimal',
        ).length,
        identityClosed,
        results: patriciaResults,
      }),
    )
  },
  120000,
)

forcedResidualProfileIt(
  'checks exact forced-customer residual support for tight extra3 identities',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const targetGroupIndexes = [
      187, 223, 247, 307, 344, 457, 609, 666, 1279,
    ] as const
    const thresholdCounts = [3, 1, 1, 0] as const
    const results = []

    for (const groupIndex of targetGroupIndexes) {
      const fixedGroup = groups[groupIndex]
      expect(fixedGroup?.eligibleCustomerIds.length).toBe(8)
      const built = build311ExtraCostSumSupportMaster(
        domain,
        groupIndex,
        undefined,
        {
          includeCustomerFlow: true,
          forcedCustomerIds: fixedGroup.eligibleCustomerIds,
        },
      )
      const solved = await solveBounded(built.model, 0.5)
      let exactStatus: string | null = null
      let supportSize = 0
      if (solved.status === 'optimal' && solved.namedSolution) {
        const support = groups.flatMap((_group, supportGroupIndex) => {
          const raw = solved.namedSolution!.get(
            `s31su_${supportGroupIndex}`,
          )
          return typeof raw === 'number' &&
            Number.isFinite(raw) &&
            raw > 0.5
            ? [supportGroupIndex]
            : []
        })
        supportSize = support.length
        if (support.length !== 30) {
          throw new Error(
            `Expected 30 residual support groups for identity ${groupIndex}, got ${support.length}`,
          )
        }
        const exact = buildFinalizing30MaskPartitionStage(
          domain,
          new Set<ProductionStepKind>([
            'juicing',
            'seasoning',
            'blending',
          ]),
          thresholdCounts,
          { max: 76 },
          0,
          new Set(support),
        )
        const exactSolved = await solveBounded(exact.model, 3)
        exactStatus = exactSolved.status
      }
      results.push({
        groupIndex,
        groupCost: fixedGroup.ingredientCost,
        status: solved.status,
        solveMs: Math.round(solved.solveMs),
        supportSize,
        exactStatus,
      })
    }

    console.info(
      '[machine-forced-residual-summary]',
      JSON.stringify({
        closedByResidualSupport: results
          .filter((entry) => entry.status === 'infeasible')
          .map((entry) => entry.groupIndex),
        customerFeasibleSupports: results
          .filter((entry) => entry.status === 'optimal')
          .map((entry) => entry.groupIndex),
        unresolved: results
          .filter(
            (entry) =>
              entry.status !== 'infeasible' &&
              entry.status !== 'optimal',
          )
          .map((entry) => entry.groupIndex),
        results,
      }),
    )
  },
  120000,
)

function build311FixedIdentitySupportMaster(
  domain: BatchOptimizationModel,
  fixedExtra3GroupIndex: number,
  fixedSlackGroupIndex: number,
  options: {
    supportCuts?: readonly (readonly number[])[]
    hallCuts?: readonly (readonly number[])[]
    includeCustomerFlow?: boolean
  } = {},
) {
  const supportCuts = options.supportCuts ?? []
  const hallCuts = options.hallCuts ?? []
  const includeCustomerFlow = options.includeCustomerFlow ?? true
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const flowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >([...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]))
  if (includeCustomerFlow) {
    const customerFlowTypes = customerMaskFlowTypes(
      domain.serviceableCustomerIds,
      maskCustomerIds,
    )
    customerFlowTypes.forEach((customerType, typeIndex) => {
      const demand = customerType.customerIds.length
      const terms = customerType.neighborMaskKeys.map(
        (maskKey, neighborIndex) => {
          const flow = model.numVar(
            0,
            demand,
            `s31y_${typeIndex}_${neighborIndex}`,
          )
          flowByMask.get(maskKey)!.push(flow)
          return flow
        },
      )
      model.addConstraint(
        sum(...terms).eq(demand),
        `s31_customer_type_${typeIndex}`,
      )
    })
  }

  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const extraOneByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const productionCostTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const capacityTermsByGroupIndex = new Map<
    number,
    ReturnType<ReturnType<Model['boolVar']>['times']>[]
  >()

  groups.forEach((group, groupIndex) => {
    const upperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const used = model.boolVar(`s31u_${groupIndex}`)
    usedGroupVars.push(used)

    if (groupIndex === fixedExtra3GroupIndex) {
      if (upperBound < 4) {
        model.addConstraint(
          used.leq(-1),
          's31_invalid_extra3_capacity',
        )
      }
      model.addConstraint(used.eq(1), 's31_fixed_extra3_used')
      productionCostTerms.push(
        used.times(group.ingredientCost * 4),
      )
      capacityTermsByGroupIndex.set(groupIndex, [
        used.times(8),
      ])
      return
    }

    productionCostTerms.push(used.times(group.ingredientCost))
    const capacityTerms = [used.times(2)]
    if (upperBound >= 2) {
      const extraOne = model.boolVar(`s31e1_${groupIndex}`)
      extraOneByGroupIndex.set(groupIndex, extraOne)
      model.addConstraint(
        extraOne.minus(used).leq(0),
        `s31_extra_used_${groupIndex}`,
      )
      productionCostTerms.push(
        extraOne.times(group.ingredientCost),
      )
      capacityTerms.push(extraOne.times(2))
    }
    capacityTermsByGroupIndex.set(groupIndex, capacityTerms)
  })

  if (
    fixedSlackGroupIndex === fixedExtra3GroupIndex ||
    groups[fixedSlackGroupIndex]?.ingredientCost !==
      SLACK_RECIPE_COST
  ) {
    model.addConstraint(
      sum(...usedGroupVars).leq(-1),
      's31_invalid_fixed_slack',
    )
  } else {
    model.addConstraint(
      usedGroupVars[fixedSlackGroupIndex].eq(1),
      's31_fixed_slack_used',
    )
    const slackExtra =
      extraOneByGroupIndex.get(fixedSlackGroupIndex)
    if (slackExtra) {
      model.addConstraint(
        slackExtra.eq(0),
        's31_fixed_slack_no_extra',
      )
    }
  }

  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    's31_used_groups',
  )
  model.addConstraint(
    sum(...extraOneByGroupIndex.values()).eq(2),
    's31_extra_one_groups',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    's31_production_cost',
  )

  if (includeCustomerFlow) {
    let maskIndex = 0
    for (const [maskKey, groupIndexes] of groupIndexesByMask) {
      const capacityTerms = groupIndexes.flatMap(
        (groupIndex) =>
          capacityTermsByGroupIndex.get(groupIndex) ?? [],
      )
      const slackTerm = groupIndexes.includes(
        fixedSlackGroupIndex,
      )
        ? [usedGroupVars[fixedSlackGroupIndex]]
        : []
      model.addConstraint(
        sum(...capacityTerms)
          .minus(sum(...slackTerm))
          .minus(sum(...(flowByMask.get(maskKey) ?? [])))
          .eq(0),
        `s31_mask_capacity_${maskIndex}`,
      )
      maskIndex += 1
    }
  }

  hallCuts.forEach((groupIndexes, cutIndex) => {
    const customerIds = new Set<string>()
    const capacityTerms = groupIndexes.flatMap((groupIndex) => {
      for (const customerId of groups[groupIndex].eligibleCustomerIds) {
        customerIds.add(customerId)
      }
      return capacityTermsByGroupIndex.get(groupIndex) ?? []
    })
    const slackTerm = groupIndexes.includes(fixedSlackGroupIndex)
      ? [usedGroupVars[fixedSlackGroupIndex]]
      : []
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...slackTerm))
        .leq(customerIds.size),
      `s31_hall_cut_${cutIndex}`,
    )
  })

  supportCuts.forEach((support, cutIndex) => {
    model.addConstraint(
      sum(
        ...support.map(
          (groupIndex) => usedGroupVars[groupIndex],
        ),
      ).leq(29),
      `s31_support_nogood_${cutIndex}`,
    )
  })

  model.minimize(sum(...usedGroupVars))
  return {
    model,
    groups,
    usedGroupVars,
    extraOneByGroupIndex,
  }
}

function buildFinalizing30GroupSupportMaster(
  domain: BatchOptimizationModel,
  extraThresholdCounts: readonly [number, number, number, number],
  options: {
    slackExtraCount?: number
    extraIdentityCuts?: readonly (
      readonly { groupIndex: number; extra: number }[]
    )[]
    requiredExactExtraCost?: {
      extra: number
      cost: number
    }
    allowedExactExtraCosts?: {
      extra: number
      costs: readonly number[]
      count: number
    }
    requiredExactExtraGroup?: {
      groupIndex: number
      extra: number
    }
    fixedSlackGroupIndex?: number
    supportCuts?: readonly (readonly number[])[]
  } = {},
) {
  const slackExtraCount = options.slackExtraCount
  const extraIdentityCuts = options.extraIdentityCuts ?? []
  const supportCuts = options.supportCuts ?? []
  const requiredExactExtraCost = options.requiredExactExtraCost
  const allowedExactExtraCosts = options.allowedExactExtraCosts
  const requiredExactExtraGroup = options.requiredExactExtraGroup
  const fixedSlackGroupIndex = options.fixedSlackGroupIndex
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const flowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >([...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]))
  const customerFlowTypes = customerMaskFlowTypes(
    domain.serviceableCustomerIds,
    maskCustomerIds,
  )
  let customerFlowVariableCount = 0
  customerFlowTypes.forEach((customerType, typeIndex) => {
    const demand = customerType.customerIds.length
    const terms = customerType.neighborMaskKeys.map(
      (maskKey, neighborIndex) => {
        const flow = model.numVar(
          0,
          demand,
          `sgy_${typeIndex}_${neighborIndex}`,
        )
        customerFlowVariableCount += 1
        flowByMask.get(maskKey)!.push(flow)
        return flow
      },
    )
    model.addConstraint(
      sum(...terms).eq(demand),
      `sg_customer_type_${typeIndex}`,
    )
  })

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<
    number,
    ReturnType<Model['intVar']>
  >()
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const slackByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const extraThresholdVarsByLevel = Array.from(
    { length: PROCESSING_STACK_CAPACITY - 1 },
    () => [] as ReturnType<Model['boolVar']>[],
  )
  const extraThresholdVarsByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>[]
  >()

  groups.forEach((group, groupIndex) => {
    const upperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(
        1,
        Math.ceil(group.eligibleCustomerIds.length / 2),
      ),
    )
    const production = model.intVar(
      0,
      upperBound,
      `sgx_${groupIndex}`,
    )
    const used = model.boolVar(`sgu_${groupIndex}`)
    productionVars.push(production)
    productionCostTerms.push(
      production.times(group.ingredientCost),
    )
    groupProductionByIndex.set(groupIndex, production)
    usedGroupVars.push(used)
    model.addConstraint(
      production.minus(used.times(upperBound)).leq(0),
      `sg_use_upper_${groupIndex}`,
    )
    model.addConstraint(
      used.minus(production).leq(0),
      `sg_use_lower_${groupIndex}`,
    )

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`sgs_${groupIndex}`)
      slackVars.push(slack)
      slackByGroupIndex.set(groupIndex, slack)
      model.addConstraint(
        slack.minus(used).leq(0),
        `sg_slack_used_${groupIndex}`,
      )
    }

    const thresholds = Array.from(
      { length: Math.max(0, upperBound - 1) },
      (_, thresholdIndex) => {
        const threshold = model.boolVar(
          `sge_${thresholdIndex + 1}_${groupIndex}`,
        )
        extraThresholdVarsByLevel[thresholdIndex].push(threshold)
        return threshold
      },
    )
    extraThresholdVarsByGroupIndex.set(groupIndex, thresholds)
    model.addConstraint(
      production.minus(used).minus(sum(...thresholds)).eq(0),
      `sg_exact_extra_${groupIndex}`,
    )
    for (
      let thresholdIndex = 1;
      thresholdIndex < thresholds.length;
      thresholdIndex += 1
    ) {
      model.addConstraint(
        thresholds[thresholdIndex]
          .minus(thresholds[thresholdIndex - 1])
          .leq(0),
        `sg_extra_monotone_${groupIndex}_${thresholdIndex}`,
      )
    }
  })

  let maskIndex = 0
  for (const [maskKey, groupIndexes] of groupIndexesByMask) {
    const capacityTerms = groupIndexes.map((groupIndex) =>
      groupProductionByIndex.get(groupIndex)!.times(2),
    )
    const maskSlacks = groupIndexes.flatMap((groupIndex) => {
      const slack = slackByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...maskSlacks))
        .minus(sum(...(flowByMask.get(maskKey) ?? [])))
        .eq(0),
      `sg_mask_capacity_${maskIndex}`,
    )
    maskIndex += 1
  }

  if (typeof slackExtraCount === 'number') {
    const targetUnits = 1 + slackExtraCount
    const bigM = PROCESSING_STACK_CAPACITY
    groups.forEach((group, groupIndex) => {
      if (group.ingredientCost !== SLACK_RECIPE_COST) return
      const slack = slackByGroupIndex.get(groupIndex)
      const production = groupProductionByIndex.get(groupIndex)
      if (!slack || !production) return
      model.addConstraint(
        sum(production, slack.times(bigM)).leq(
          targetUnits + bigM,
        ),
        `sg_slack_extra_upper_${groupIndex}`,
      )
      model.addConstraint(
        production.minus(slack.times(bigM)).geq(
          targetUnits - bigM,
        ),
        `sg_slack_extra_lower_${groupIndex}`,
      )
    })
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'sg_global_slack',
  )
  if (typeof fixedSlackGroupIndex === 'number') {
    const fixedSlack = slackByGroupIndex.get(fixedSlackGroupIndex)
    if (!fixedSlack) {
      model.addConstraint(
        sum(...productionVars).leq(-1),
        'sg_invalid_fixed_slack_group',
      )
    } else {
      model.addConstraint(
        fixedSlack.eq(1),
        'sg_fixed_slack_group',
      )
    }
  }
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'sg_production_units',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'sg_production_cost',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'sg_used_groups',
  )
  supportCuts.forEach((support, cutIndex) => {
    model.addConstraint(
      sum(...support.map((groupIndex) => usedGroupVars[groupIndex])).leq(29),
      `sg_support_nogood_${cutIndex}`,
    )
  })
  extraThresholdCounts.forEach((count, thresholdIndex) => {
    model.addConstraint(
      sum(...extraThresholdVarsByLevel[thresholdIndex]).eq(count),
      `sg_extra_count_${thresholdIndex + 1}`,
    )
  })
  if (requiredExactExtraCost) {
    const level = requiredExactExtraCost.extra - 1
    if (
      level < 0 ||
      level >= PROCESSING_STACK_CAPACITY - 1
    ) {
      throw new Error(
        `Invalid required exact extra multiplicity: ${requiredExactExtraCost.extra}`,
      )
    }
    const currentLevel = groups.flatMap((group, groupIndex) => {
      if (group.ingredientCost !== requiredExactExtraCost.cost) {
        return []
      }
      const threshold =
        extraThresholdVarsByGroupIndex.get(groupIndex)?.[level]
      return threshold ? [threshold] : []
    })
    const nextLevel =
      level + 1 < PROCESSING_STACK_CAPACITY - 1
        ? groups.flatMap((group, groupIndex) => {
            if (
              group.ingredientCost !==
              requiredExactExtraCost.cost
            ) {
              return []
            }
            const threshold =
              extraThresholdVarsByGroupIndex.get(groupIndex)?.[
                level + 1
              ]
            return threshold ? [threshold] : []
          })
        : []
    model.addConstraint(
      sum(...currentLevel).minus(sum(...nextLevel)).geq(1),
      `sg_required_exact_extra_cost_${requiredExactExtraCost.extra}_${requiredExactExtraCost.cost}`,
    )
  }
  if (allowedExactExtraCosts) {
    const level = allowedExactExtraCosts.extra - 1
    if (
      level < 0 ||
      level >= PROCESSING_STACK_CAPACITY - 1
    ) {
      throw new Error(
        `Invalid allowed exact extra multiplicity: ${allowedExactExtraCosts.extra}`,
      )
    }
    const allowedCosts = new Set(allowedExactExtraCosts.costs)
    const currentLevel = groups.flatMap((group, groupIndex) => {
      if (!allowedCosts.has(group.ingredientCost)) return []
      const threshold =
        extraThresholdVarsByGroupIndex.get(groupIndex)?.[level]
      return threshold ? [threshold] : []
    })
    const nextLevel =
      level + 1 < PROCESSING_STACK_CAPACITY - 1
        ? groups.flatMap((group, groupIndex) => {
            if (!allowedCosts.has(group.ingredientCost)) return []
            const threshold =
              extraThresholdVarsByGroupIndex.get(groupIndex)?.[
                level + 1
              ]
            return threshold ? [threshold] : []
          })
        : []
    model.addConstraint(
      sum(...currentLevel)
        .minus(sum(...nextLevel))
        .eq(allowedExactExtraCosts.count),
      `sg_allowed_exact_extra_costs_${allowedExactExtraCosts.extra}`,
    )
  }
  if (requiredExactExtraGroup) {
    const { groupIndex, extra } = requiredExactExtraGroup
    const thresholds =
      extraThresholdVarsByGroupIndex.get(groupIndex) ?? []
    if (extra <= 0 || extra > thresholds.length) {
      model.addConstraint(
        sum(...productionVars).leq(-1),
        'sg_invalid_required_exact_extra_group',
      )
    } else {
      model.addConstraint(
        thresholds[extra - 1].eq(1),
        `sg_required_exact_extra_group_${groupIndex}_${extra}`,
      )
      if (extra < thresholds.length) {
        model.addConstraint(
          thresholds[extra].eq(0),
          `sg_required_exact_extra_group_upper_${groupIndex}_${extra}`,
        )
      }
    }
  }
  extraIdentityCuts.forEach((entries, cutIndex) => {
    const activeThresholds = entries.flatMap(
      ({ groupIndex, extra }) => {
        const thresholds =
          extraThresholdVarsByGroupIndex.get(groupIndex) ?? []
        if (extra <= 0 || extra > thresholds.length) {
          throw new Error(
            `Invalid support-master extra identity cut for group ${groupIndex}: ${extra}`,
          )
        }
        return thresholds.slice(0, extra)
      },
    )
    if (
      activeThresholds.length !==
      PRODUCTION_UNITS_FIX - 30
    ) {
      throw new Error(
        `Support-master extra identity cut must encode exactly ${
          PRODUCTION_UNITS_FIX - 30
        } extra units`,
      )
    }
    model.addConstraint(
      sum(...activeThresholds).leq(
        activeThresholds.length - 1,
      ),
      `sg_extra_identity_nogood_${cutIndex}`,
    )
  })

  model.minimize(sum(...productionVars))
  return {
    model,
    groups,
    groupProductionByIndex,
    usedGroupVars,
    slackByGroupIndex,
    groupCount: groups.length,
    serviceMaskCount: maskCustomerIds.size,
    customerFlowVariableCount,
  }
}


function buildOptimisticGroupOnlyFrontierMaster(
  domain: BatchOptimizationModel,
  extraThresholdCounts: readonly [number, number, number, number],
  options: {
    includeCustomerFlow?: boolean
    hallCuts?: readonly (readonly number[])[]
    sharedBucketMode?:
      | 'equipment'
      | 'operation-signature'
      | 'structural-signature'
    slackExtraCount?: number
    slackGroupIndex?: number
    totalNonFinalCap?: number
    supportCuts?: readonly (readonly number[])[]
    extraIdentityCuts?: readonly (
      readonly { groupIndex: number; extra: number }[]
    )[]
  } = {},
) {
  const includeCustomerFlow = options.includeCustomerFlow ?? true
  const hallCuts = options.hallCuts ?? []
  const sharedBucketMode = options.sharedBucketMode ?? 'equipment'
  const slackExtraCount = options.slackExtraCount
  const slackGroupIndex = options.slackGroupIndex
  const totalNonFinalCap = options.totalNonFinalCap
  const supportCuts = options.supportCuts ?? []
  const extraIdentityCuts = options.extraIdentityCuts ?? []
  const groups = pairGroups(domain)
  const model = new Model()

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const maskCustomerIds = new Map<string, string[]>()
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const maskKey = maskKeyForGroup(group)
    if (!maskCustomerIds.has(maskKey)) {
      maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
    }
    const indexes = groupIndexesByMask.get(maskKey)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(maskKey, [groupIndex])
  })

  const flowByMask = new Map<
    string,
    ReturnType<Model['numVar']>[]
  >([...maskCustomerIds.keys()].map((maskKey) => [maskKey, []]))
  if (includeCustomerFlow) {
    domain.serviceableCustomerIds.forEach(
      (customerId, customerIndex) => {
        const terms: ReturnType<Model['numVar']>[] = []
        ;[...maskCustomerIds.entries()].forEach(
          ([maskKey, eligibleCustomerIds], maskIndex) => {
            if (!eligibleCustomerIds.includes(customerId)) return
            const y = model.numVar(
              0,
              1,
              `goy_${customerIndex}_${maskIndex}`,
            )
            terms.push(y)
            flowByMask.get(maskKey)!.push(y)
          },
        )
        model.addConstraint(
          sum(...terms).eq(1),
          `go_customer_${customerIndex}`,
        )
      },
    )
  }

  const throughOwners = new Map<string, Set<number>>()
  const blendingOwners = new Map<string, Set<number>>()
  const sharedBucketByEdgeKey = new Map<string, string>()
  groups.forEach((group, groupIndex) => {
    for (const recipe of group.recipes) {
      for (const edge of recipe.productionPath.edges) {
        const owners =
          edge.kind === 'juicing' || edge.kind === 'seasoning'
            ? throughOwners
            : edge.kind === 'blending'
              ? blendingOwners
              : null
        if (!owners) continue
        const operationSignature =
          edge.kind === 'juicing'
            ? `juicing:${edge.addedIngredientId ?? edge.key}`
            : edge.kind === 'seasoning'
              ? `seasoning:${edge.equipment}:${edge.addedIngredientId ?? 'unknown'}`
              : `blending:${edge.fromIngredientIds.length}:${edge.secondaryFromIngredientIds?.length ?? 0}`
        const structuralSignature =
          edge.kind === 'juicing'
            ? `juicing:${edge.addedIngredientId ?? edge.key}`
            : edge.kind === 'seasoning'
              ? [
                  'seasoning',
                  edge.equipment,
                  edge.fromIngredientIds[0] ?? 'unknown-base',
                  edge.addedIngredientId ?? 'unknown-additive',
                  edge.fromIngredientIds.length,
                ].join(':')
              : [
                  'blending',
                  edge.fromIngredientIds[0] ?? 'unknown-left',
                  edge.secondaryFromIngredientIds?.[0] ?? 'unknown-right',
                  edge.fromIngredientIds.length,
                  edge.secondaryFromIngredientIds?.length ?? 0,
                ].join(':')
        sharedBucketByEdgeKey.set(
          edge.key,
          sharedBucketMode === 'equipment'
            ? edge.equipment
            : sharedBucketMode === 'operation-signature'
              ? operationSignature
              : structuralSignature,
        )
        const current = owners.get(edge.key) ?? new Set<number>()
        current.add(groupIndex)
        owners.set(edge.key, current)
      }
    }
  })
  const sharedThroughEdgeKeys = new Set(
    [...throughOwners.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([key]) => key),
  )
  const sharedBlendingEdgeKeys = new Set(
    [...blendingOwners.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([key]) => key),
  )

  const productionVars: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['intVar']>['times']
  >[] = []
  const groupProductionByIndex = new Map<
    number,
    ReturnType<Model['intVar']>
  >()
  const usedGroupVars: ReturnType<Model['boolVar']>[] = []
  const slackVars: ReturnType<Model['boolVar']>[] = []
  const slackByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>
  >()
  const extraThresholdVarsByLevel = Array.from(
    { length: PROCESSING_STACK_CAPACITY - 1 },
    () => [] as ReturnType<Model['boolVar']>[],
  )
  const extraThresholdVarsByGroupIndex = new Map<
    number,
    ReturnType<Model['boolVar']>[]
  >()
  const privateThroughTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const sharedThroughTermsByEquipment = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedThroughUpperBoundByEquipment = new Map<string, number>()
  const privateBlendTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const sharedBlendTermsByEquipment = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()
  const sharedBlendUpperBoundByEquipment = new Map<string, number>()

  groups.forEach((group, groupIndex) => {
    const upperBound = Math.min(
      PROCESSING_STACK_CAPACITY,
      Math.max(1, Math.ceil(group.eligibleCustomerIds.length / 2)),
    )
    const x = model.intVar(0, upperBound, `gox_${groupIndex}`)
    const used = model.boolVar(`gou_${groupIndex}`)
    productionVars.push(x)
    usedGroupVars.push(used)
    groupProductionByIndex.set(groupIndex, x)
    productionCostTerms.push(x.times(group.ingredientCost))
    model.addConstraint(
      x.minus(used.times(upperBound)).leq(0),
      `go_use_upper_${groupIndex}`,
    )
    model.addConstraint(
      used.minus(x).leq(0),
      `go_use_lower_${groupIndex}`,
    )

    const profiles = group.recipes.map((recipe) => {
      const throughMultiplicity = new Map<string, number>()
      const blendMultiplicity = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (edge.kind === 'juicing' || edge.kind === 'seasoning') {
          throughMultiplicity.set(
            edge.key,
            (throughMultiplicity.get(edge.key) ?? 0) + 1,
          )
        } else if (edge.kind === 'blending') {
          blendMultiplicity.set(
            edge.key,
            (blendMultiplicity.get(edge.key) ?? 0) + 1,
          )
        }
      }
      let privateThrough = 0
      const sharedThroughByEquipment = new Map<string, number>()
      for (const [key, multiplicity] of throughMultiplicity) {
        if (sharedThroughEdgeKeys.has(key)) {
          const equipment = sharedBucketByEdgeKey.get(key) ?? 'unknown'
          sharedThroughByEquipment.set(
            equipment,
            (sharedThroughByEquipment.get(equipment) ?? 0) +
              multiplicity,
          )
        } else {
          privateThrough += 1
        }
      }
      let privateBlend = 0
      const sharedBlendByEquipment = new Map<string, number>()
      for (const [key, multiplicity] of blendMultiplicity) {
        if (sharedBlendingEdgeKeys.has(key)) {
          const equipment = sharedBucketByEdgeKey.get(key) ?? 'unknown'
          sharedBlendByEquipment.set(
            equipment,
            (sharedBlendByEquipment.get(equipment) ?? 0) +
              multiplicity,
          )
        } else {
          privateBlend += 1
        }
      }
      return {
        privateThrough,
        sharedThroughByEquipment,
        privateBlend,
        sharedBlendByEquipment,
      }
    })
    const minPrivateThrough = Math.min(
      ...profiles.map((profile) => profile.privateThrough),
    )
    const minPrivateBlend = Math.min(
      ...profiles.map((profile) => profile.privateBlend),
    )
    if (minPrivateThrough > 0) {
      privateThroughTerms.push(used.times(minPrivateThrough))
    }
    if (minPrivateBlend > 0) {
      privateBlendTerms.push(used.times(minPrivateBlend))
    }

    const sharedThroughEquipments = new Set(
      profiles.flatMap((profile) => [
        ...profile.sharedThroughByEquipment.keys(),
      ]),
    )
    for (const equipment of sharedThroughEquipments) {
      const minimum = Math.min(
        ...profiles.map(
          (profile) =>
            profile.sharedThroughByEquipment.get(equipment) ?? 0,
        ),
      )
      if (minimum <= 0) continue
      const terms =
        sharedThroughTermsByEquipment.get(equipment) ?? []
      terms.push(x.times(minimum))
      sharedThroughTermsByEquipment.set(equipment, terms)
      sharedThroughUpperBoundByEquipment.set(
        equipment,
        (sharedThroughUpperBoundByEquipment.get(equipment) ?? 0) +
          upperBound * minimum,
      )
    }

    const sharedBlendEquipments = new Set(
      profiles.flatMap((profile) => [
        ...profile.sharedBlendByEquipment.keys(),
      ]),
    )
    for (const equipment of sharedBlendEquipments) {
      const minimum = Math.min(
        ...profiles.map(
          (profile) =>
            profile.sharedBlendByEquipment.get(equipment) ?? 0,
        ),
      )
      if (minimum <= 0) continue
      const terms =
        sharedBlendTermsByEquipment.get(equipment) ?? []
      terms.push(x.times(minimum))
      sharedBlendTermsByEquipment.set(equipment, terms)
      sharedBlendUpperBoundByEquipment.set(
        equipment,
        (sharedBlendUpperBoundByEquipment.get(equipment) ?? 0) +
          upperBound * minimum,
      )
    }

    if (group.ingredientCost === SLACK_RECIPE_COST) {
      const slack = model.boolVar(`gos_${groupIndex}`)
      slackVars.push(slack)
      slackByGroupIndex.set(groupIndex, slack)
      model.addConstraint(
        slack.minus(used).leq(0),
        `go_slack_used_${groupIndex}`,
      )
    }

    const thresholds = Array.from(
      { length: Math.max(0, upperBound - 1) },
      (_, thresholdIndex) => {
        const threshold = model.boolVar(
          `goe_${thresholdIndex + 1}_${groupIndex}`,
        )
        extraThresholdVarsByLevel[thresholdIndex].push(threshold)
        return threshold
      },
    )
    extraThresholdVarsByGroupIndex.set(groupIndex, thresholds)
    model.addConstraint(
      x.minus(used).minus(sum(...thresholds)).eq(0),
      `go_exact_extra_${groupIndex}`,
    )
    for (
      let thresholdIndex = 1;
      thresholdIndex < thresholds.length;
      thresholdIndex += 1
    ) {
      model.addConstraint(
        thresholds[thresholdIndex]
          .minus(thresholds[thresholdIndex - 1])
          .leq(0),
        `go_extra_monotone_${groupIndex}_${thresholdIndex}`,
      )
    }
  })

  if (includeCustomerFlow) {
    let maskIndex = 0
    for (const [maskKey, groupIndexes] of groupIndexesByMask) {
      const capacityTerms = groupIndexes.map((groupIndex) =>
        groupProductionByIndex.get(groupIndex)!.times(2),
      )
      const maskSlacks = groupIndexes.flatMap((groupIndex) => {
        const slack = slackByGroupIndex.get(groupIndex)
        return slack ? [slack] : []
      })
      model.addConstraint(
        sum(...capacityTerms)
          .minus(sum(...maskSlacks))
          .minus(sum(...(flowByMask.get(maskKey) ?? [])))
          .eq(0),
        `go_mask_capacity_${maskIndex}`,
      )
      maskIndex += 1
    }
  }

  hallCuts.forEach((groupIndexes, cutIndex) => {
    const customerIds = new Set<string>()
    const capacityTerms = groupIndexes.map((groupIndex) => {
      for (const customerId of groups[groupIndex].eligibleCustomerIds) {
        customerIds.add(customerId)
      }
      return groupProductionByIndex.get(groupIndex)!.times(2)
    })
    const cutSlacks = groupIndexes.flatMap((groupIndex) => {
      const slack = slackByGroupIndex.get(groupIndex)
      return slack ? [slack] : []
    })
    model.addConstraint(
      sum(...capacityTerms)
        .minus(sum(...cutSlacks))
        .leq(customerIds.size),
      `go_hall_cut_${cutIndex}`,
    )
  })

  if (typeof slackExtraCount === 'number') {
    const targetUnits = 1 + slackExtraCount
    const bigM = PROCESSING_STACK_CAPACITY
    groups.forEach((group, groupIndex) => {
      if (group.ingredientCost !== SLACK_RECIPE_COST) return
      const slack = slackByGroupIndex.get(groupIndex)
      const production = groupProductionByIndex.get(groupIndex)
      if (!slack || !production) return
      model.addConstraint(
        sum(production, slack.times(bigM)).leq(targetUnits + bigM),
        `go_slack_extra_upper_${groupIndex}`,
      )
      model.addConstraint(
        production
          .minus(slack.times(bigM))
          .geq(targetUnits - bigM),
        `go_slack_extra_lower_${groupIndex}`,
      )
    })
  }

  model.addConstraint(
    sum(...slackVars).eq(GLOBAL_SERVING_SLACK),
    'go_global_slack',
  )
  if (typeof slackGroupIndex === 'number') {
    const fixedSlack = slackByGroupIndex.get(slackGroupIndex)
    if (!fixedSlack) {
      model.addConstraint(
        sum(...productionVars).leq(-1),
        'go_invalid_fixed_slack_group',
      )
    } else {
      model.addConstraint(
        fixedSlack.eq(1),
        'go_fixed_slack_group',
      )
    }
  }
  model.addConstraint(
    sum(...productionVars).eq(PRODUCTION_UNITS_FIX),
    'go_production_units',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(PRODUCTION_COST_FIX),
    'go_production_cost',
  )
  model.addConstraint(
    sum(...usedGroupVars).eq(30),
    'go_used_groups',
  )
  supportCuts.forEach((support, cutIndex) => {
    model.addConstraint(
      sum(...support.map((groupIndex) => usedGroupVars[groupIndex])).leq(29),
      `go_support_nogood_${cutIndex}`,
    )
  })
  extraIdentityCuts.forEach((entries, cutIndex) => {
    const activeThresholds = entries.flatMap(({ groupIndex, extra }) => {
      const thresholds =
        extraThresholdVarsByGroupIndex.get(groupIndex) ?? []
      if (extra <= 0 || extra > thresholds.length) {
        throw new Error(
          `Invalid extra identity cut for group ${groupIndex}: ${extra}`,
        )
      }
      return thresholds.slice(0, extra)
    })
    if (
      activeThresholds.length !==
      PRODUCTION_UNITS_FIX - 30
    ) {
      throw new Error(
        `Extra identity cut must encode exactly ${
          PRODUCTION_UNITS_FIX - 30
        } extra units`,
      )
    }
    model.addConstraint(
      sum(...activeThresholds).leq(activeThresholds.length - 1),
      `go_extra_identity_nogood_${cutIndex}`,
    )
  })
  extraThresholdCounts.forEach((count, thresholdIndex) => {
    model.addConstraint(
      sum(...extraThresholdVarsByLevel[thresholdIndex]).eq(count),
      `go_extra_count_${thresholdIndex + 1}`,
    )
  })

  const sharedThroughOps: ReturnType<Model['intVar']>[] = []
  let sharedBucketIndex = 0
  for (const [equipment, terms] of sharedThroughTermsByEquipment) {
    const operation = model.intVar(
      0,
      Math.max(
        1,
        Math.ceil(
          (sharedThroughUpperBoundByEquipment.get(equipment) ?? 0) /
            PROCESSING_STACK_CAPACITY,
        ),
      ),
      `go_shared_through_op_${sharedBucketIndex}`,
    )
    const quantity = sum(...terms)
    model.addConstraint(
      quantity
        .minus(operation.times(PROCESSING_STACK_CAPACITY))
        .leq(0),
      `go_shared_through_capacity_${sharedBucketIndex}`,
    )
    model.addConstraint(
      operation.minus(quantity).leq(0),
      `go_shared_through_usage_${sharedBucketIndex}`,
    )
    sharedThroughOps.push(operation)
    sharedBucketIndex += 1
  }

  const sharedBlendOps: ReturnType<Model['intVar']>[] = []
  sharedBucketIndex = 0
  for (const [equipment, terms] of sharedBlendTermsByEquipment) {
    const operation = model.intVar(
      0,
      Math.max(
        1,
        Math.ceil(
          (sharedBlendUpperBoundByEquipment.get(equipment) ?? 0) /
            PROCESSING_STACK_CAPACITY,
        ),
      ),
      `go_shared_blend_op_${sharedBucketIndex}`,
    )
    const quantity = sum(...terms)
    model.addConstraint(
      quantity
        .minus(operation.times(PROCESSING_STACK_CAPACITY))
        .leq(0),
      `go_shared_blend_capacity_${sharedBucketIndex}`,
    )
    model.addConstraint(
      operation.minus(quantity).leq(0),
      `go_shared_blend_usage_${sharedBucketIndex}`,
    )
    sharedBlendOps.push(operation)
    sharedBucketIndex += 1
  }

  const optimisticThrough = sum(
    ...privateThroughTerms,
    ...sharedThroughOps,
  )
  const optimisticBlending = sum(
    ...privateBlendTerms,
    ...sharedBlendOps,
  )
  if (typeof totalNonFinalCap === 'number') {
    model.addConstraint(
      optimisticThrough.plus(optimisticBlending).leq(totalNonFinalCap),
      'go_nonfinal_total_cap',
    )
  } else {
    model.addConstraint(
      optimisticThrough.leq(41),
      'go_through_cap',
    )
    model.addConstraint(
      optimisticBlending.leq(35),
      'go_blending_cap',
    )
  }
  model.minimize(sum(...productionVars))
  return {
    model,
    groups,
    groupProductionByIndex,
    slackByGroupIndex,
    usedGroupVars,
    groupCount: groups.length,
    serviceMaskCount: maskCustomerIds.size,
  }
}




it.skip(
  'checks equipment-bucket group-only finalizing-30 extra frontiers',
  async () => {
    const domain = canonicalDomain()
    const cases = [
      { pattern: '3+1+1', thresholds: [3, 1, 1, 0] as const },
      { pattern: '2+2+1', thresholds: [3, 2, 0, 0] as const },
      { pattern: '2+1+1+1', thresholds: [4, 1, 0, 0] as const },
      { pattern: '1+1+1+1+1', thresholds: [5, 0, 0, 0] as const },
    ]
    const results = []
    for (const extraCase of cases) {
      const built = buildOptimisticGroupOnlyFrontierMaster(
        domain,
        extraCase.thresholds,
      )
      const solved = await solveBoundedWithProgress(built.model, 10)
      const result = {
        pattern: extraCase.pattern,
        status: solved.status,
        objective: solved.objective,
        solveMs: Math.round(solved.solveMs),
        progressTail: solved.progressTail,
      }
      results.push(result)
      console.info(
        '[machine-equipment-bucket-case]',
        JSON.stringify(result),
      )
    }
    console.info(
      '[machine-equipment-bucket-summary]',
      JSON.stringify(
        results.map((result) => ({
          pattern: result.pattern,
          status: result.status,
          objective: result.objective,
        })),
      ),
    )
  },
  90000,
)


it.skip(
  'checks operation-signature-bucket finalizing-30 extra frontiers',
  async () => {
    const domain = canonicalDomain()
    const cases = [
      { pattern: '2+2+1', thresholds: [3, 2, 0, 0] as const },
      { pattern: '2+1+1+1', thresholds: [4, 1, 0, 0] as const },
      { pattern: '1+1+1+1+1', thresholds: [5, 0, 0, 0] as const },
    ]
    const results = []
    for (const extraCase of cases) {
      const built = buildOptimisticGroupOnlyFrontierMaster(
        domain,
        extraCase.thresholds,
        { sharedBucketMode: 'operation-signature' },
      )
      const solved = await solveBoundedWithProgress(built.model, 10)
      const result = {
        pattern: extraCase.pattern,
        status: solved.status,
        objective: solved.objective,
        solveMs: Math.round(solved.solveMs),
        progressTail: solved.progressTail,
      }
      results.push(result)
      console.info(
        '[machine-operation-signature-case]',
        JSON.stringify(result),
      )
    }
    console.info(
      '[machine-operation-signature-summary]',
      JSON.stringify(
        results.map((result) => ({
          pattern: result.pattern,
          status: result.status,
          objective: result.objective,
        })),
      ),
    )
  },
  90000,
)


it.skip(
  'summarizes exact extra-bearing group eligibility',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const rows = groups.map((group) => ({
      key: group.key,
      eligibleCustomers: group.eligibleCustomerIds.length,
      upperBound: Math.min(
        PROCESSING_STACK_CAPACITY,
        Math.max(1, Math.ceil(group.eligibleCustomerIds.length / 2)),
      ),
      ingredientCost: group.ingredientCost,
      recipeCount: group.recipes.length,
    }))
    const summary = {
      groupCount: rows.length,
      upperBoundAtLeast2: rows.filter((row) => row.upperBound >= 2).length,
      upperBoundAtLeast3: rows.filter((row) => row.upperBound >= 3).length,
      upperBoundAtLeast4: rows.filter((row) => row.upperBound >= 4).length,
      upperBoundAtLeast5: rows.filter((row) => row.upperBound >= 5).length,
      slackCostGroups: rows.filter((row) => row.ingredientCost === SLACK_RECIPE_COST).length,
      slackCostUpperBounds: rows
        .filter((row) => row.ingredientCost === SLACK_RECIPE_COST)
        .reduce<Record<number, number>>((counts, row) => {
          counts[row.upperBound] = (counts[row.upperBound] ?? 0) + 1
          return counts
        }, {}),
      largestGroups: rows
        .filter((row) => row.upperBound >= 3)
        .sort((a, b) =>
          b.upperBound - a.upperBound ||
          b.eligibleCustomers - a.eligibleCustomers ||
          a.ingredientCost - b.ingredientCost,
        )
        .slice(0, 80)
        .map(({ eligibleCustomers, upperBound, ingredientCost, recipeCount }) => ({
          eligibleCustomers,
          upperBound,
          ingredientCost,
          recipeCount,
        })),
    }
    console.info('[machine-extra-eligibility]', JSON.stringify(summary))
  },
  90000,
)


it.skip(
  'summarizes exact customer-mask equivalence classes',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const maskCustomerIds = new Map<string, string[]>()
    for (const group of groups) {
      const maskKey = group.eligibleCustomerIds.join('\u001e')
      if (!maskCustomerIds.has(maskKey)) {
        maskCustomerIds.set(maskKey, group.eligibleCustomerIds)
      }
    }

    const maskKeys = [...maskCustomerIds.keys()]
    const neighborsByCustomerId = new Map<string, string[]>(
      domain.serviceableCustomerIds.map((customerId) => [
        customerId,
        maskKeys.filter((maskKey) =>
          maskCustomerIds.get(maskKey)!.includes(customerId),
        ),
      ]),
    )
    const types = new Map<
      string,
      { customerIds: string[]; neighborMaskKeys: string[] }
    >()
    for (const customerId of domain.serviceableCustomerIds) {
      const neighborMaskKeys = neighborsByCustomerId.get(customerId) ?? []
      const signature = neighborMaskKeys.join('\u001d')
      const current = types.get(signature)
      if (current) current.customerIds.push(customerId)
      else {
        types.set(signature, {
          customerIds: [customerId],
          neighborMaskKeys,
        })
      }
    }

    const typeRows = [...types.values()]
      .map((type) => ({
        demand: type.customerIds.length,
        neighborMasks: type.neighborMaskKeys.length,
      }))
      .sort(
        (a, b) =>
          b.demand - a.demand ||
          b.neighborMasks - a.neighborMasks,
      )
    console.info(
      '[machine-customer-mask-types]',
      JSON.stringify({
        customerCount: domain.serviceableCustomerIds.length,
        serviceMaskCount: maskCustomerIds.size,
        customerTypeCount: typeRows.length,
        originalFlowVariables: [...neighborsByCustomerId.values()]
          .reduce((sum, neighbors) => sum + neighbors.length, 0),
        aggregatedFlowVariables: typeRows.reduce(
          (sum, row) => sum + row.neighborMasks,
          0,
        ),
        multiCustomerTypes: typeRows.filter((row) => row.demand > 1),
      }),
    )
  },
  90000,
)


function maximumAssignmentFlowForGroupCapacities(
  groups: readonly PairGroup[],
  serviceableCustomerIds: readonly string[],
  capacities: readonly number[],
): {
  flow: number
  violatingGroupIndexes: number[]
} {
  const source = 0
  const groupOffset = 1
  const customerOffset = groupOffset + groups.length
  const sink = customerOffset + serviceableCustomerIds.length
  const nodeCount = sink + 1
  type Edge = { to: number; rev: number; capacity: number }
  const graph: Edge[][] = Array.from({ length: nodeCount }, () => [])

  const addEdge = (from: number, to: number, capacity: number) => {
    const forward: Edge = { to, rev: graph[to].length, capacity }
    const reverse: Edge = { to: from, rev: graph[from].length, capacity: 0 }
    graph[from].push(forward)
    graph[to].push(reverse)
  }

  const customerIndexById = new Map(
    serviceableCustomerIds.map((id, index) => [id, index]),
  )
  groups.forEach((group, groupIndex) => {
    const capacity = Math.max(0, Math.round(capacities[groupIndex] ?? 0))
    if (capacity <= 0) return
    addEdge(source, groupOffset + groupIndex, capacity)
    for (const customerId of group.eligibleCustomerIds) {
      const customerIndex = customerIndexById.get(customerId)
      if (customerIndex === undefined) continue
      addEdge(
        groupOffset + groupIndex,
        customerOffset + customerIndex,
        serviceableCustomerIds.length + 1,
      )
    }
  })
  serviceableCustomerIds.forEach((_, customerIndex) => {
    addEdge(customerOffset + customerIndex, sink, 1)
  })

  let flow = 0
  while (true) {
    const level = Array(nodeCount).fill(-1)
    const queue = [source]
    level[source] = 0
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head]
      for (const edge of graph[node]) {
        if (edge.capacity <= 0 || level[edge.to] >= 0) continue
        level[edge.to] = level[node] + 1
        queue.push(edge.to)
      }
    }
    if (level[sink] < 0) break

    const next = Array(nodeCount).fill(0)
    const dfs = (node: number, amount: number): number => {
      if (node === sink) return amount
      for (; next[node] < graph[node].length; next[node] += 1) {
        const edge = graph[node][next[node]]
        if (
          edge.capacity <= 0 ||
          level[edge.to] !== level[node] + 1
        ) {
          continue
        }
        const sent = dfs(edge.to, Math.min(amount, edge.capacity))
        if (sent <= 0) continue
        edge.capacity -= sent
        graph[edge.to][edge.rev].capacity += sent
        return sent
      }
      return 0
    }

    while (true) {
      const sent = dfs(source, serviceableCustomerIds.length)
      if (sent <= 0) break
      flow += sent
    }
  }

  const reachable = Array(nodeCount).fill(false)
  const queue = [source]
  reachable[source] = true
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]
    for (const edge of graph[node]) {
      if (edge.capacity <= 0 || reachable[edge.to]) continue
      reachable[edge.to] = true
      queue.push(edge.to)
    }
  }
  const violatingCustomerIds = new Set(
    serviceableCustomerIds.filter(
      (_customerId, customerIndex) =>
        reachable[customerOffset + customerIndex],
    ),
  )
  const violatingGroupIndexes = groups.flatMap((group, groupIndex) =>
    group.eligibleCustomerIds.length > 0 &&
    group.eligibleCustomerIds.every((customerId) =>
      violatingCustomerIds.has(customerId),
    )
      ? [groupIndex]
      : [],
  )

  return { flow, violatingGroupIndexes }
}

it.skip(
  'checks Hall-cut decomposition of finalizing-30 extra frontiers',
  async () => {
    const domain = canonicalDomain()
    const cases = [
      { pattern: '3+1+1', thresholds: [3, 1, 1, 0] as const },
      { pattern: '2+2+1', thresholds: [3, 2, 0, 0] as const },
      { pattern: '2+1+1+1', thresholds: [4, 1, 0, 0] as const },
      { pattern: '1+1+1+1+1', thresholds: [5, 0, 0, 0] as const },
    ]
    const results = []

    for (const extraCase of cases) {
      const hallCuts: number[][] = []
      let finalStatus = 'iteration-limit'
      let solveMs = 0
      let flow = 0
      let lastCutSize = 0

      for (let iteration = 0; iteration < 40; iteration += 1) {
        const built = buildOptimisticGroupOnlyFrontierMaster(
          domain,
          extraCase.thresholds,
          { includeCustomerFlow: false, hallCuts },
        )
        const solved = await solveBounded(built.model, 3)
        solveMs += solved.solveMs
        if (solved.status !== 'optimal' || !solved.namedSolution) {
          finalStatus = solved.status
          break
        }

        const capacities = built.groups.map((group, groupIndex) => {
          const unitsRaw = solved.namedSolution!.get(
            `gox_${groupIndex}`,
          )
          if (
            typeof unitsRaw !== 'number' ||
            !Number.isFinite(unitsRaw)
          ) {
            throw new Error(
              `Missing Hall group production ${groupIndex}`,
            )
          }
          const units = Math.round(unitsRaw)
          let slackValue = 0
          if (group.ingredientCost === SLACK_RECIPE_COST) {
            const slackRaw = solved.namedSolution!.get(
              `gos_${groupIndex}`,
            )
            if (
              typeof slackRaw !== 'number' ||
              !Number.isFinite(slackRaw)
            ) {
              throw new Error(
                `Missing Hall group slack ${groupIndex}`,
              )
            }
            slackValue = Math.round(slackRaw)
          }
          return units * 2 - slackValue
        })
        const checked = maximumAssignmentFlowForGroupCapacities(
          built.groups,
          domain.serviceableCustomerIds,
          capacities,
        )
        flow = checked.flow
        if (flow === domain.serviceableCustomerIds.length) {
          finalStatus = 'assignment-feasible-relaxation'
          break
        }
        if (checked.violatingGroupIndexes.length === 0) {
          finalStatus = 'invalid-empty-cut'
          break
        }
        lastCutSize = checked.violatingGroupIndexes.length
        hallCuts.push(checked.violatingGroupIndexes)
      }

      const result = {
        pattern: extraCase.pattern,
        status: finalStatus,
        hallCuts: hallCuts.length,
        assignmentFlow: flow,
        lastCutSize,
        totalSolveMs: Math.round(solveMs),
      }
      results.push(result)
      console.info('[machine-hall-cut-case]', JSON.stringify(result))
    }

    console.info('[machine-hall-cut-summary]', JSON.stringify(results))
  },
  180000,
)


it.skip(
  'checks structural-signature finalizing-30 extra frontiers',
  async () => {
    const domain = canonicalDomain()
    const cases = [
      { pattern: '3+1+1', thresholds: [3, 1, 1, 0] as const },
      { pattern: '2+2+1', thresholds: [3, 2, 0, 0] as const },
      { pattern: '2+1+1+1', thresholds: [4, 1, 0, 0] as const },
      { pattern: '1+1+1+1+1', thresholds: [5, 0, 0, 0] as const },
    ]
    const results = []
    for (const extraCase of cases) {
      const built = buildOptimisticGroupOnlyFrontierMaster(
        domain,
        extraCase.thresholds,
        { sharedBucketMode: 'structural-signature' },
      )
      const solved = await solveBoundedWithProgress(built.model, 10)
      const result = {
        pattern: extraCase.pattern,
        status: solved.status,
        objective: solved.objective,
        solveMs: Math.round(solved.solveMs),
        progressTail: solved.progressTail,
      }
      results.push(result)
      console.info(
        '[machine-structural-signature-case]',
        JSON.stringify(result),
      )
    }
    console.info(
      '[machine-structural-signature-summary]',
      JSON.stringify(
        results.map((result) => ({
          pattern: result.pattern,
          status: result.status,
          objective: result.objective,
        })),
      ),
    )
  },
  90000,
)

// CI trigger: structural-signature exact frontier profile


it.skip(
  'checks singleton-group exact extra subcases',
  async () => {
    const domain = canonicalDomain()
    const cases = [
      {
        pattern: '2+2+1',
        thresholds: [3, 2, 0, 0] as const,
        slackExtras: [0, 1, 2] as const,
      },
      {
        pattern: '2+1+1+1',
        thresholds: [4, 1, 0, 0] as const,
        slackExtras: [0, 1, 2] as const,
      },
      {
        pattern: '1+1+1+1+1',
        thresholds: [5, 0, 0, 0] as const,
        slackExtras: [0, 1] as const,
      },
    ]
    const results = []
    for (const extraCase of cases) {
      for (const slackExtraCount of extraCase.slackExtras) {
        const built = buildOptimisticGroupOnlyFrontierMaster(
          domain,
          extraCase.thresholds,
          {
            sharedBucketMode: 'structural-signature',
            slackExtraCount,
          },
        )
        const solved = await solveBoundedWithProgress(built.model, 10)
        const result = {
          pattern: extraCase.pattern,
          slackExtraCount,
          status: solved.status,
          objective: solved.objective,
          solveMs: Math.round(solved.solveMs),
          progressTail: solved.progressTail,
        }
        results.push(result)
        console.info(
          '[machine-slack-extra-case]',
          JSON.stringify(result),
        )
      }
    }
    console.info(
      '[machine-slack-extra-summary]',
      JSON.stringify(
        results.map((result) => ({
          pattern: result.pattern,
          slackExtraCount: result.slackExtraCount,
          status: result.status,
          objective: result.objective,
        })),
      ),
    )
  },
  150000,
)


it.skip(
  'enumerates singleton group for all-ones extra pattern',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const slackGroupIndexes = groups.flatMap((group, groupIndex) =>
      group.ingredientCost === SLACK_RECIPE_COST ? [groupIndex] : [],
    )
    const results = []
    for (const slackGroupIndex of slackGroupIndexes) {
      const built = buildOptimisticGroupOnlyFrontierMaster(
        domain,
        [5, 0, 0, 0],
        {
          sharedBucketMode: 'structural-signature',
          slackExtraCount: 0,
          slackGroupIndex,
        },
      )
      const solved = await solveBounded(built.model, 2)
      const result = {
        slackGroupIndex,
        status: solved.status,
        objective: solved.objective,
        solveMs: Math.round(solved.solveMs),
      }
      results.push(result)
      console.info(
        '[machine-singleton-group-case]',
        JSON.stringify(result),
      )
    }
    console.info(
      '[machine-singleton-group-summary]',
      JSON.stringify({
        total: results.length,
        infeasible: results.filter((result) => result.status === 'infeasible').length,
        optimal: results.filter((result) => result.status === 'optimal').length,
        timelimit: results.filter((result) => result.status === 'timelimit').length,
        unresolvedGroupIndexes: results
          .filter((result) => result.status !== 'infeasible')
          .map((result) => result.slackGroupIndex),
      }),
    )
  },
  120000,
)


it.skip(
  'checks shared Hall-cut pool across finalizing-30 extra frontiers',
  async () => {
    const domain = canonicalDomain()
    const cases = [
      { pattern: '3+1+1', thresholds: [3, 1, 1, 0] as const },
      { pattern: '2+2+1', thresholds: [3, 2, 0, 0] as const },
      { pattern: '2+1+1+1', thresholds: [4, 1, 0, 0] as const },
      { pattern: '1+1+1+1+1', thresholds: [5, 0, 0, 0] as const },
    ]
    const hallCuts: number[][] = []
    const hallCutKeys = new Set<string>()
    const states = cases.map((entry) => ({
      pattern: entry.pattern,
      status: 'unresolved',
      assignmentFlow: 0,
      solves: 0,
      solveMs: 0,
    }))

    for (let round = 0; round < 25; round += 1) {
      let addedCutThisRound = false

      for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
        const state = states[caseIndex]
        if (
          state.status === 'infeasible' ||
          state.status === 'assignment-feasible-relaxation'
        ) {
          continue
        }

        const extraCase = cases[caseIndex]
        const built = buildOptimisticGroupOnlyFrontierMaster(
          domain,
          extraCase.thresholds,
          { includeCustomerFlow: false, hallCuts },
        )
        const solved = await solveBounded(built.model, 1.5)
        state.solves += 1
        state.solveMs += solved.solveMs

        if (solved.status === 'infeasible') {
          state.status = 'infeasible'
          continue
        }
        if (solved.status !== 'optimal' || !solved.namedSolution) {
          state.status = solved.status
          continue
        }

        const capacities = built.groups.map((group, groupIndex) => {
          const unitsRaw = solved.namedSolution!.get(
            `gox_${groupIndex}`,
          )
          if (
            typeof unitsRaw !== 'number' ||
            !Number.isFinite(unitsRaw)
          ) {
            throw new Error(
              `Missing shared-Hall group production ${groupIndex}`,
            )
          }
          const units = Math.round(unitsRaw)
          let slackValue = 0
          if (group.ingredientCost === SLACK_RECIPE_COST) {
            const slackRaw = solved.namedSolution!.get(
              `gos_${groupIndex}`,
            )
            if (
              typeof slackRaw !== 'number' ||
              !Number.isFinite(slackRaw)
            ) {
              throw new Error(
                `Missing shared-Hall group slack ${groupIndex}`,
              )
            }
            slackValue = Math.round(slackRaw)
          }
          return units * 2 - slackValue
        })
        const checked = maximumAssignmentFlowForGroupCapacities(
          built.groups,
          domain.serviceableCustomerIds,
          capacities,
        )
        state.assignmentFlow = checked.flow
        if (checked.flow === domain.serviceableCustomerIds.length) {
          state.status = 'assignment-feasible-relaxation'
          continue
        }
        if (checked.violatingGroupIndexes.length === 0) {
          state.status = 'invalid-empty-cut'
          continue
        }

        const cutKey = checked.violatingGroupIndexes.join(',')
        if (!hallCutKeys.has(cutKey)) {
          hallCutKeys.add(cutKey)
          hallCuts.push(checked.violatingGroupIndexes)
          addedCutThisRound = true
        }
        state.status = 'cut-added'
      }

      console.info(
        '[machine-shared-hall-round]',
        JSON.stringify({
          round: round + 1,
          hallCuts: hallCuts.length,
          states: states.map((state) => ({
            pattern: state.pattern,
            status: state.status,
            assignmentFlow: state.assignmentFlow,
          })),
        }),
      )

      if (!addedCutThisRound) break
    }

    console.info(
      '[machine-shared-hall-summary]',
      JSON.stringify({
        hallCuts: hallCuts.length,
        states: states.map((state) => ({
          pattern: state.pattern,
          status: state.status,
          assignmentFlow: state.assignmentFlow,
          solves: state.solves,
          solveMs: Math.round(state.solveMs),
        })),
      }),
    )
  },
  180000,
)


it.skip(
  'checks 3+1+1 singleton extra subcases',
  async () => {
    const domain = canonicalDomain()
    const results = []
    for (const slackExtraCount of [0, 1, 3] as const) {
      const built = buildOptimisticGroupOnlyFrontierMaster(
        domain,
        [3, 1, 1, 0],
        {
          sharedBucketMode: 'structural-signature',
          slackExtraCount,
        },
      )
      const solved = await solveBoundedWithProgress(built.model, 10)
      const result = {
        pattern: '3+1+1',
        slackExtraCount,
        status: solved.status,
        objective: solved.objective,
        solveMs: Math.round(solved.solveMs),
        progressTail: solved.progressTail,
      }
      results.push(result)
      console.info('[machine-311-slack-extra-case]', JSON.stringify(result))
    }
    console.info(
      '[machine-311-slack-extra-summary]',
      JSON.stringify(
        results.map((result) => ({
          slackExtraCount: result.slackExtraCount,
          status: result.status,
          objective: result.objective,
        })),
      ),
    )
  },
  60000,
)


extraIdentityProfileIt(
  'decomposes finalizing-30 extra-bearing identities exactly',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const structureMaskCustomerIds = new Map<string, string[]>()
    const structureGroupsByMask = new Map<string, number>()
    const structureCostCounts = new Map<number, number>()
    groups.forEach((group) => {
      const maskKey = group.eligibleCustomerIds.join('\u001e')
      if (!structureMaskCustomerIds.has(maskKey)) {
        structureMaskCustomerIds.set(
          maskKey,
          group.eligibleCustomerIds,
        )
      }
      structureGroupsByMask.set(
        maskKey,
        (structureGroupsByMask.get(maskKey) ?? 0) + 1,
      )
      structureCostCounts.set(
        group.ingredientCost,
        (structureCostCounts.get(group.ingredientCost) ?? 0) + 1,
      )
    })
    const structureFlowTypes = customerMaskFlowTypes(
      domain.serviceableCustomerIds,
      structureMaskCustomerIds,
    )
    const structureRows = groups.map((group) => ({
      maskKey: group.eligibleCustomerIds.join('\u001e'),
      eligibleCustomers: group.eligibleCustomerIds.length,
      ingredientCost: group.ingredientCost,
      maxExtra:
        Math.min(
          PROCESSING_STACK_CAPACITY,
          Math.max(
            1,
            Math.ceil(group.eligibleCustomerIds.length / 2),
          ),
        ) - 1,
    }))
    console.info(
      '[machine-extra-structure]',
      JSON.stringify({
        groupCount: groups.length,
        serviceMaskCount: structureMaskCustomerIds.size,
        customerFlowTypeCount: structureFlowTypes.length,
        uniqueIngredientCostCount: structureCostCounts.size,
        groupsPerMask: {
          min: Math.min(...structureGroupsByMask.values()),
          max: Math.max(...structureGroupsByMask.values()),
          multiCostMasks: [...structureGroupsByMask.values()].filter(
            (count) => count > 1,
          ).length,
        },
        commonCosts: [...structureCostCounts.entries()]
          .sort(
            ([leftCost, leftCount], [rightCost, rightCount]) =>
              rightCount - leftCount || leftCost - rightCost,
          )
          .slice(0, 24),
        extraEligibility: [1, 2, 3, 4].map((extra) => {
          const eligible = structureRows.filter(
            (row) => row.maxExtra >= extra,
          )
          return {
            extra,
            groups: eligible.length,
            masks: new Set(
              eligible.map((row) => row.maskKey),
            ).size,
            costs: new Set(
              eligible.map((row) => row.ingredientCost),
            ).size,
            slackCostGroups: eligible.filter(
              (row) =>
                row.ingredientCost === SLACK_RECIPE_COST,
            ).length,
          }
        }),
      }),
    )
    const requestedPattern =
      machineContinuationEnv.MACHINE_CONTINUATION_JOINT_PATTERN ??
      '3+1+1'
    const cases = [
      { pattern: '5', extras: [5] as const },
      { pattern: '4+1', extras: [4, 1] as const },
      { pattern: '3+2', extras: [3, 2] as const },
      { pattern: '3+1+1', extras: [3, 1, 1] as const },
      { pattern: '2+2+1', extras: [2, 2, 1] as const },
      { pattern: '2+1+1+1', extras: [2, 1, 1, 1] as const },
      {
        pattern: '1+1+1+1+1',
        extras: [1, 1, 1, 1, 1] as const,
      },
    ]
    const companionByRequested: Record<string, string | undefined> = {
      '3+1+1': '5',
      '2+2+1': '4+1',
      '2+1+1+1': '3+2',
    }
    const patternNames = [
      companionByRequested[requestedPattern],
      requestedPattern,
    ].filter((pattern): pattern is string => Boolean(pattern))
    const maxExtraByGroupIndex = groups.map((group) => {
      const upperBound = Math.min(
        PROCESSING_STACK_CAPACITY,
        Math.max(
          1,
          Math.ceil(group.eligibleCustomerIds.length / 2),
        ),
      )
      return upperBound - 1
    })

    const results = []
    for (const patternName of patternNames) {
      const extraCase = cases.find(
        (candidate) => candidate.pattern === patternName,
      )
      expect(extraCase).toBeDefined()
      if (!extraCase) continue

      const sortedExtras = [...extraCase.extras].sort(
        (left, right) => right - left,
      )
      const capacityFeasible = sortedExtras.every(
        (extra, rank) =>
          maxExtraByGroupIndex.filter(
            (maxExtra) => maxExtra >= extra,
          ).length >=
          rank + 1,
      )
      const candidateCounts = sortedExtras.map((extra) => ({
        extra,
        groups: maxExtraByGroupIndex.filter(
          (maxExtra) => maxExtra >= extra,
        ).length,
      }))
      if (!capacityFeasible) {
        const result = {
          pattern: extraCase.pattern,
          status: 'static-infeasible',
          candidateCounts,
          subcases: [],
        }
        results.push(result)
        console.info(
          '[machine-extra-identity-summary]',
          JSON.stringify(result),
        )
        continue
      }

      const thresholdCounts = Array.from(
        { length: PROCESSING_STACK_CAPACITY - 1 },
        (_, thresholdIndex) =>
          extraCase.extras.filter(
            (extra) => extra >= thresholdIndex + 1,
          ).length,
      ) as [number, number, number, number]
      const slackExtraCounts = [
        0,
        ...new Set(extraCase.extras),
      ].filter(
        (extra) => extra <= PROCESSING_STACK_CAPACITY - 1,
      )

      const subcases = []
      for (const slackExtraCount of slackExtraCounts) {
        const coarseMaster = buildFinalizing30GroupSupportMaster(
          domain,
          thresholdCounts,
          { slackExtraCount },
        )
        const coarseSolved = await solveBounded(
          coarseMaster.model,
          1.5,
        )
        if (coarseSolved.status === 'infeasible') {
          const subcase = {
            slackExtraCount,
            status: 'infeasible',
            highestExtra: sortedExtras[0],
            candidateCosts: 0,
            infeasibleCosts: 0,
            optimalCosts: [] as number[],
            unresolvedCosts: [] as number[],
            solveMs: Math.round(coarseSolved.solveMs),
          }
          subcases.push(subcase)
          console.info(
            '[machine-extra-cost-subcase]',
            JSON.stringify({
              pattern: extraCase.pattern,
              ...subcase,
            }),
          )
          continue
        }

        const highestExtra = sortedExtras[0]
        const candidateCosts = [
          ...new Set(
            groups.flatMap((group, groupIndex) =>
              maxExtraByGroupIndex[groupIndex] >= highestExtra
                ? [group.ingredientCost]
                : [],
            ),
          ),
        ].sort((left, right) => left - right)
        const costResults: Array<{
          cost: number
          status: string
          solveMs: number
        }> = []

        for (const cost of candidateCosts) {
          const built = buildFinalizing30GroupSupportMaster(
            domain,
            thresholdCounts,
            {
              slackExtraCount,
              requiredExactExtraCost: {
                extra: highestExtra,
                cost,
              },
            },
          )
          const solved = await solveBounded(built.model, 1.5)
          costResults.push({
            cost,
            status: solved.status,
            solveMs: Math.round(solved.solveMs),
          })
        }

        const infeasibleCosts = costResults
          .filter((entry) => entry.status === 'infeasible')
          .map((entry) => entry.cost)
        const optimalCosts = costResults
          .filter((entry) => entry.status === 'optimal')
          .map((entry) => entry.cost)
        const unresolvedCosts = costResults
          .filter(
            (entry) =>
              entry.status !== 'infeasible' &&
              entry.status !== 'optimal',
          )
          .map((entry) => entry.cost)
        const survivingCosts = [
          ...optimalCosts,
          ...unresolvedCosts,
        ].sort((left, right) => left - right)
        const highestExtraCount = sortedExtras.filter(
          (extra) => extra === highestExtra,
        ).length
        let combinedStatus = 'not-run'
        let combinedSolveMs = 0
        if (survivingCosts.length > 0) {
          const combined = buildFinalizing30GroupSupportMaster(
            domain,
            thresholdCounts,
            {
              slackExtraCount,
              allowedExactExtraCosts: {
                extra: highestExtra,
                costs: survivingCosts,
                count: highestExtraCount,
              },
            },
          )
          const combinedSolved = await solveBounded(
            combined.model,
            2,
          )
          combinedStatus = combinedSolved.status
          combinedSolveMs = combinedSolved.solveMs
        }
        let groupIdentitySplit:
          | {
              candidateGroups: number
              infeasibleGroups: number
              optimalGroups: number[]
              unresolvedGroups: number[]
              incumbentSupports: number
              exactInfeasibleIncumbentSupports: number
              exactOptimalIncumbentSupports: Array<{
                groupIndex: number
                objective: number | null
              }>
              invalidIncumbentSupports: Array<{
                groupIndex: number
                supportSize: number | null
              }>
              solveMs: number
            }
          | undefined
        if (
          extraCase.pattern === '3+1+1' &&
          slackExtraCount === 0 &&
          survivingCosts.length > 0 &&
          combinedStatus !== 'infeasible'
        ) {
          const survivingCostSet = new Set(survivingCosts)
          const candidateGroupIndexes = groups.flatMap(
            (group, groupIndex) =>
              survivingCostSet.has(group.ingredientCost) &&
              maxExtraByGroupIndex[groupIndex] >= highestExtra
                ? [groupIndex]
                : [],
          )
          const identityResults: Array<{
            groupIndex: number
            status: string
            solveMs: number
            supportSize: number | null
            exactSupportStatus: string | null
            exactSupportObjective: number | null
            exactSupportSolveMs: number
          }> = []
          for (const groupIndex of candidateGroupIndexes) {
            const built = buildFinalizing30GroupSupportMaster(
              domain,
              thresholdCounts,
              {
                slackExtraCount,
                allowedExactExtraCosts: {
                  extra: highestExtra,
                  costs: survivingCosts,
                  count: highestExtraCount,
                },
                requiredExactExtraGroup: {
                  groupIndex,
                  extra: highestExtra,
                },
              },
            )
            const solved = await solveBounded(built.model, 0.75)
            let supportSize: number | null = null
            let exactSupportStatus: string | null = null
            let exactSupportObjective: number | null = null
            let exactSupportSolveMs = 0
            if (
              solved.status !== 'infeasible' &&
              solved.namedSolution
            ) {
              const support = groups.flatMap(
                (_group, supportGroupIndex) => {
                  const raw = solved.namedSolution!.get(
                    `sgu_${supportGroupIndex}`,
                  )
                  return typeof raw === 'number' &&
                    Number.isFinite(raw) &&
                    raw > 0.5
                    ? [supportGroupIndex]
                    : []
                },
              )
              supportSize = support.length
              if (support.length === 30) {
                const exact = buildFinalizing30MaskPartitionStage(
                  domain,
                  new Set<ProductionStepKind>([
                    'juicing',
                    'seasoning',
                    'blending',
                  ]),
                  thresholdCounts,
                  { max: 76 },
                  slackExtraCount,
                  new Set(support),
                )
                const exactSolved = await solveBounded(exact.model, 4)
                exactSupportStatus = exactSolved.status
                exactSupportObjective = exactSolved.objective
                exactSupportSolveMs = Math.round(exactSolved.solveMs)
              } else {
                exactSupportStatus = 'invalid-support-size'
              }
            }
            identityResults.push({
              groupIndex,
              status: solved.status,
              solveMs: Math.round(solved.solveMs),
              supportSize,
              exactSupportStatus,
              exactSupportObjective,
              exactSupportSolveMs,
            })
          }
          groupIdentitySplit = {
            candidateGroups: candidateGroupIndexes.length,
            infeasibleGroups: identityResults.filter(
              (entry) => entry.status === 'infeasible',
            ).length,
            optimalGroups: identityResults
              .filter((entry) => entry.status === 'optimal')
              .map((entry) => entry.groupIndex),
            unresolvedGroups: identityResults
              .filter(
                (entry) =>
                  entry.status !== 'infeasible' &&
                  entry.status !== 'optimal',
              )
              .map((entry) => entry.groupIndex),
            incumbentSupports: identityResults.filter(
              (entry) => entry.supportSize === 30,
            ).length,
            exactInfeasibleIncumbentSupports: identityResults.filter(
              (entry) => entry.exactSupportStatus === 'infeasible',
            ).length,
            exactOptimalIncumbentSupports: identityResults
              .filter((entry) => entry.exactSupportStatus === 'optimal')
              .map((entry) => ({
                groupIndex: entry.groupIndex,
                objective: entry.exactSupportObjective,
              })),
            invalidIncumbentSupports: identityResults
              .filter(
                (entry) =>
                  entry.supportSize !== null &&
                  entry.supportSize !== 30,
              )
              .map((entry) => ({
                groupIndex: entry.groupIndex,
                supportSize: entry.supportSize,
              })),
            solveMs: identityResults.reduce(
              (total, entry) =>
                total + entry.solveMs + entry.exactSupportSolveMs,
              0,
            ),
          }
          console.info(
            '[machine-extra-group-identity-split]',
            JSON.stringify({
              pattern: extraCase.pattern,
              slackExtraCount,
              highestExtra,
              survivingCosts,
              ...groupIdentitySplit,
            }),
          )
        }
        const groupIdentityClosed =
          groupIdentitySplit !== undefined &&
          groupIdentitySplit.candidateGroups > 0 &&
          groupIdentitySplit.infeasibleGroups ===
            groupIdentitySplit.candidateGroups
        const subcase = {
          slackExtraCount,
          status:
            survivingCosts.length === 0 ||
            combinedStatus === 'infeasible' ||
            groupIdentityClosed
              ? 'infeasible'
              : groupIdentitySplit
                ? 'group-identity-unresolved'
                : 'cost-frontier-unresolved',
          highestExtra,
          highestExtraCount,
          candidateCosts: candidateCosts.length,
          infeasibleCosts: infeasibleCosts.length,
          optimalCosts,
          unresolvedCosts,
          combinedStatus,
          solveMs: Math.round(
            coarseSolved.solveMs +
              costResults.reduce(
                (total, entry) => total + entry.solveMs,
                0,
              ) +
              combinedSolveMs +
              (groupIdentitySplit?.solveMs ?? 0),
          ),
          groupIdentitySplit,
        }
        subcases.push(subcase)
        console.info(
          '[machine-extra-cost-subcase]',
          JSON.stringify({
            pattern: extraCase.pattern,
            ...subcase,
          }),
        )
      }

      const status = subcases.every(
        (subcase) => subcase.status === 'infeasible',
      )
        ? 'infeasible'
        : 'unresolved'
      const result = {
        pattern: extraCase.pattern,
        status,
        candidateCounts,
        subcases,
      }
      results.push(result)
      console.info(
        '[machine-extra-identity-summary]',
        JSON.stringify(result),
      )
    }

    console.info(
      '[machine-extra-identity-matrix-summary]',
      JSON.stringify(results),
    )
    expect(
      results.every(
        (result) =>
          result.status === 'static-infeasible' ||
          result.status === 'infeasible',
      ),
    ).toBe(true)
  },
  300000,
)


partialSupportProfileIt(
  'decomposes unresolved 3+1+1 identities by companion-extra cost and support',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const rawGroupIndexes =
      machineContinuationEnv.MACHINE_CONTINUATION_PARTIAL_GROUPS ?? ''
    const targetGroupIndexes = rawGroupIndexes
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value))
    expect(targetGroupIndexes.length).toBeGreaterThan(0)

    const thresholdCounts = [3, 1, 1, 0] as const
    const maxExtraByGroupIndex = groups.map((group) => {
      const upperBound = Math.min(
        PROCESSING_STACK_CAPACITY,
        Math.max(
          1,
          Math.ceil(group.eligibleCustomerIds.length / 2),
        ),
      )
      return upperBound - 1
    })
    const companionCosts = [
      ...new Set(
        groups.flatMap((group, groupIndex) =>
          maxExtraByGroupIndex[groupIndex] >= 1
            ? [group.ingredientCost]
            : [],
        ),
      ),
    ].sort((left, right) => left - right)

    const identityResults = []
    let globalWitness:
      | {
          groupIndex: number
          companionCost: number
          support: number[]
          objective: number | null
        }
      | undefined

    for (const groupIndex of targetGroupIndexes) {
      expect(groups[groupIndex]).toBeDefined()
      expect(maxExtraByGroupIndex[groupIndex]).toBeGreaterThanOrEqual(3)

      const costResults = []
      for (const companionCost of companionCosts) {
        const supportCuts: number[][] = []
        let status = 'round-limit'
        let exactInfeasibleSupports = 0
        let masterSolveMs = 0
        let exactSolveMs = 0

        for (let round = 0; round < 2; round += 1) {
          const built = buildFinalizing30GroupSupportMaster(
            domain,
            thresholdCounts,
            {
              slackExtraCount: 0,
              requiredExactExtraGroup: {
                groupIndex,
                extra: 3,
              },
              requiredExactExtraCost: {
                extra: 1,
                cost: companionCost,
              },
              supportCuts,
            },
          )
          const solved = await solveBounded(built.model, 0.4)
          masterSolveMs += solved.solveMs

          if (solved.status === 'infeasible') {
            status = 'infeasible'
            break
          }
          if (
            solved.status !== 'optimal' ||
            !solved.namedSolution
          ) {
            status = solved.status
            break
          }

          const support = groups.flatMap(
            (_group, supportGroupIndex) => {
              const raw = solved.namedSolution!.get(
                `sgu_${supportGroupIndex}`,
              )
              return typeof raw === 'number' &&
                Number.isFinite(raw) &&
                raw > 0.5
                ? [supportGroupIndex]
                : []
            },
          )
          if (support.length !== 30) {
            throw new Error(
              `Expected 30 support groups for identity ${groupIndex} / cost ${companionCost}, got ${support.length}`,
            )
          }

          const exact = buildFinalizing30MaskPartitionStage(
            domain,
            new Set<ProductionStepKind>([
              'juicing',
              'seasoning',
              'blending',
            ]),
            thresholdCounts,
            { max: 76 },
            0,
            new Set(support),
          )
          const exactSolved = await solveBounded(exact.model, 3)
          exactSolveMs += exactSolved.solveMs
          if (exactSolved.status === 'infeasible') {
            exactInfeasibleSupports += 1
            supportCuts.push(support)
            continue
          }
          if (exactSolved.status === 'optimal') {
            status = 'global-witness'
            globalWitness = {
              groupIndex,
              companionCost,
              support,
              objective: exactSolved.objective,
            }
            break
          }
          status = `exact-${exactSolved.status}`
          break
        }

        costResults.push({
          companionCost,
          status,
          supportCuts: supportCuts.length,
          exactInfeasibleSupports,
          masterSolveMs: Math.round(masterSolveMs),
          exactSolveMs: Math.round(exactSolveMs),
        })
        if (globalWitness) break
      }

      const unresolvedCosts = costResults
        .filter((entry) => entry.status !== 'infeasible')
        .map((entry) => ({
          cost: entry.companionCost,
          status: entry.status,
          supportCuts: entry.supportCuts,
        }))
      const result = {
        groupIndex,
        groupCost: groups[groupIndex].ingredientCost,
        companionCostCount: companionCosts.length,
        infeasibleCosts: costResults.filter(
          (entry) => entry.status === 'infeasible',
        ).length,
        unresolvedCosts,
        exactInfeasibleSupports: costResults.reduce(
          (total, entry) =>
            total + entry.exactInfeasibleSupports,
          0,
        ),
        solveMs: costResults.reduce(
          (total, entry) =>
            total + entry.masterSolveMs + entry.exactSolveMs,
          0,
        ),
      }
      identityResults.push(result)
      console.info(
        '[machine-partial-support-identity]',
        JSON.stringify(result),
      )
      if (globalWitness) break
    }

    console.info(
      '[machine-partial-support-summary]',
      JSON.stringify({
        targetGroupIndexes,
        closedIdentities: identityResults
          .filter((entry) => entry.unresolvedCosts.length === 0)
          .map((entry) => entry.groupIndex),
        unresolvedIdentities: identityResults
          .filter((entry) => entry.unresolvedCosts.length > 0)
          .map((entry) => entry.groupIndex),
        globalWitness,
      }),
    )

    expect(globalWitness).toBeUndefined()
    expect(
      identityResults.every(
        (entry) => entry.unresolvedCosts.length === 0,
      ),
    ).toBe(true)
  },
  300000,
)



extraSumProfileIt(
  'decomposes unresolved 3+1+1 identities by extra-one cost sum and support',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const rawGroupIndexes =
      machineContinuationEnv.MACHINE_CONTINUATION_EXTRA_SUM_GROUPS ?? ''
    const targetGroupIndexes = rawGroupIndexes
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value))
    expect(targetGroupIndexes.length).toBeGreaterThan(0)

    const thresholdCounts = [3, 1, 1, 0] as const
    const maxExtraByGroupIndex = groups.map((group) => {
      const upperBound = Math.min(
        PROCESSING_STACK_CAPACITY,
        Math.max(
          1,
          Math.ceil(group.eligibleCustomerIds.length / 2),
        ),
      )
      return upperBound - 1
    })
    const eligibleExtraOneCosts = groups.flatMap(
      (group, groupIndex) =>
        maxExtraByGroupIndex[groupIndex] >= 1
          ? [group.ingredientCost]
          : [],
    )
    const possibleExtraOneCostSums = new Set<number>()
    for (
      let leftIndex = 0;
      leftIndex < eligibleExtraOneCosts.length;
      leftIndex += 1
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < eligibleExtraOneCosts.length;
        rightIndex += 1
      ) {
        possibleExtraOneCostSums.add(
          eligibleExtraOneCosts[leftIndex] +
            eligibleExtraOneCosts[rightIndex],
        )
      }
    }
    const costSums = [...possibleExtraOneCostSums].sort(
      (left, right) => left - right,
    )

    const identityResults = []
    const sharedHallCuts =
      await bootstrap311HallCutsFromDpWitnesses(domain, groups)
    const sharedHallCutKeys = new Set(
      sharedHallCuts.map((cut) => cut.join(',')),
    )
    const hallCustomerSets = sharedHallCuts.map((cut) => {
      const customerIds = new Set<string>()
      for (const groupIndex of cut) {
        for (const customerId of groups[groupIndex].eligibleCustomerIds) {
          customerIds.add(customerId)
        }
      }
      return customerIds
    })
    let nestedHallPairs = 0
    let disjointHallPairs = 0
    let crossingHallPairs = 0
    for (
      let leftIndex = 0;
      leftIndex < hallCustomerSets.length;
      leftIndex += 1
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < hallCustomerSets.length;
        rightIndex += 1
      ) {
        const left = hallCustomerSets[leftIndex]
        const right = hallCustomerSets[rightIndex]
        const intersectionSize = [...left].filter((customerId) =>
          right.has(customerId),
        ).length
        if (intersectionSize === 0) {
          disjointHallPairs += 1
          continue
        }
        if (
          intersectionSize === left.size ||
          intersectionSize === right.size
        ) {
          nestedHallPairs += 1
          continue
        }
        crossingHallPairs += 1
      }
    }
    console.info(
      '[machine-extra-sum-bootstrap-hall]',
      JSON.stringify({
        hallCuts: sharedHallCuts.length,
        groupSizes: sharedHallCuts.map((cut) => cut.length),
        customerSizes: hallCustomerSets.map((set) => set.size),
        nestedHallPairs,
        disjointHallPairs,
        crossingHallPairs,
      }),
    )
    let globalWitness:
      | {
          groupIndex: number
          extraOneCostSum: number
          support: number[]
          objective: number | null
        }
      | undefined

    for (const groupIndex of targetGroupIndexes) {
      const sumResults = []
      for (const extraOneCostSum of costSums) {
        const baseSupportCost =
          PRODUCTION_COST_FIX -
          3 * groups[groupIndex].ingredientCost -
          extraOneCostSum
        const theoreticalMinSupportCost =
          SLACK_RECIPE_COST +
          29 * Math.min(...groups.map((group) => group.ingredientCost))
        const theoreticalMaxSupportCost =
          SLACK_RECIPE_COST +
          29 * Math.max(...groups.map((group) => group.ingredientCost))
        if (
          baseSupportCost < theoreticalMinSupportCost ||
          baseSupportCost > theoreticalMaxSupportCost
        ) {
          sumResults.push({
            extraOneCostSum,
            baseSupportCost,
            status: 'static-infeasible',
            supportCuts: 0,
            exactInfeasibleSupports: 0,
            masterSolveMs: 0,
            exactSolveMs: 0,
          })
          continue
        }

        const supportCuts: number[][] = []
        const hallCutsAtStart = sharedHallCuts.length
        let status = 'round-limit'
        let exactInfeasibleSupports = 0
        let assignmentFlow = 0
        let masterSolveMs = 0
        let exactSolveMs = 0

        for (let round = 0; round < 4; round += 1) {
          const built = build311ExtraCostSumSupportMaster(
            domain,
            groupIndex,
            extraOneCostSum,
            {
              supportCuts,
              hallCuts: sharedHallCuts,
              includeCustomerFlow: false,
            },
          )
          const solved = await solveBounded(built.model, 0.5)
          masterSolveMs += solved.solveMs
          if (solved.status === 'infeasible') {
            status = 'infeasible'
            break
          }
          if (
            solved.status !== 'optimal' ||
            !solved.namedSolution
          ) {
            status = solved.status
            break
          }

          const support = groups.flatMap(
            (_group, supportGroupIndex) => {
              const raw = solved.namedSolution!.get(
                `s31su_${supportGroupIndex}`,
              )
              return typeof raw === 'number' &&
                Number.isFinite(raw) &&
                raw > 0.5
                ? [supportGroupIndex]
                : []
            },
          )
          if (support.length !== 30) {
            throw new Error(
              `Expected 30 support groups for extra group ${groupIndex} / extra-one cost sum ${extraOneCostSum}, got ${support.length}`,
            )
          }

          const capacities = groups.map((_group, capacityGroupIndex) => {
            const usedRaw = solved.namedSolution!.get(
              `s31su_${capacityGroupIndex}`,
            )
            const used =
              typeof usedRaw === 'number' &&
              Number.isFinite(usedRaw) &&
              usedRaw > 0.5
                ? 1
                : 0
            if (capacityGroupIndex === groupIndex) return used * 8
            const extraRaw = solved.namedSolution!.get(
              `s31se1_${capacityGroupIndex}`,
            )
            const extra =
              typeof extraRaw === 'number' &&
              Number.isFinite(extraRaw) &&
              extraRaw > 0.5
                ? 1
                : 0
            const slackRaw = solved.namedSolution!.get(
              `s31sslack_${capacityGroupIndex}`,
            )
            const slack =
              typeof slackRaw === 'number' &&
              Number.isFinite(slackRaw) &&
              slackRaw > 0.5
                ? 1
                : 0
            return used * 2 + extra * 2 - slack
          })
          const checked = maximumAssignmentFlowForGroupCapacities(
            groups,
            domain.serviceableCustomerIds,
            capacities,
          )
          assignmentFlow = checked.flow
          if (checked.flow !== domain.serviceableCustomerIds.length) {
            if (checked.violatingGroupIndexes.length === 0) {
              status = 'invalid-empty-hall-cut'
              break
            }
            const hallCutKey = checked.violatingGroupIndexes.join(',')
            if (sharedHallCutKeys.has(hallCutKey)) {
              status = 'duplicate-hall-cut'
              break
            }
            sharedHallCutKeys.add(hallCutKey)
            sharedHallCuts.push(checked.violatingGroupIndexes)
            continue
          }

          const exact = buildFinalizing30MaskPartitionStage(
            domain,
            new Set<ProductionStepKind>([
              'juicing',
              'seasoning',
              'blending',
            ]),
            thresholdCounts,
            { max: 76 },
            0,
            new Set(support),
          )
          const exactSolved = await solveBounded(exact.model, 3)
          exactSolveMs += exactSolved.solveMs
          if (exactSolved.status === 'infeasible') {
            exactInfeasibleSupports += 1
            supportCuts.push(support)
            continue
          }
          if (exactSolved.status === 'optimal') {
            status = 'global-witness'
            globalWitness = {
              groupIndex,
              extraOneCostSum,
              support,
              objective: exactSolved.objective,
            }
            break
          }
          status = `exact-${exactSolved.status}`
          break
        }

        sumResults.push({
          extraOneCostSum,
          baseSupportCost,
          status,
          supportCuts: supportCuts.length,
          exactInfeasibleSupports,
          masterSolveMs: Math.round(masterSolveMs),
          exactSolveMs: Math.round(exactSolveMs),
        })
        if (globalWitness) break
      }

      const unresolvedCostSums = sumResults
        .filter(
          (entry) =>
            entry.status !== 'infeasible' &&
            entry.status !== 'static-infeasible',
        )
        .map((entry) => ({
          extraOneCostSum: entry.extraOneCostSum,
          baseSupportCost: entry.baseSupportCost,
          status: entry.status,
          supportCuts: entry.supportCuts,
        }))
      const result = {
        groupIndex,
        groupCost: groups[groupIndex]?.ingredientCost ?? null,
        costSumCases: sumResults.length,
        infeasibleCostSums: sumResults.filter(
          (entry) =>
            entry.status === 'infeasible' ||
            entry.status === 'static-infeasible',
        ).length,
        unresolvedCostSums,
        exactInfeasibleSupports: sumResults.reduce(
          (total, entry) =>
            total + entry.exactInfeasibleSupports,
          0,
        ),
        solveMs: sumResults.reduce(
          (total, entry) =>
            total + entry.masterSolveMs + entry.exactSolveMs,
          0,
        ),
      }
      identityResults.push(result)
      console.info(
        '[machine-extra-sum-identity]',
        JSON.stringify(result),
      )
      if (globalWitness) break
    }

    console.info(
      '[machine-extra-sum-summary]',
      JSON.stringify({
        targetGroupIndexes,
        closedIdentities: identityResults
          .filter((entry) => entry.unresolvedCostSums.length === 0)
          .map((entry) => entry.groupIndex),
        unresolvedIdentities: identityResults
          .filter((entry) => entry.unresolvedCostSums.length > 0)
          .map((entry) => entry.groupIndex),
        globalWitness,
      }),
    )

    expect(globalWitness).toBeUndefined()
    expect(
      identityResults.every(
        (entry) => entry.unresolvedCostSums.length === 0,
      ),
    ).toBe(true)
  },
  300000,
)

slackSplitProfileIt(
  'decomposes unresolved 3+1+1 identities by fixed slack identity and support',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const rawGroupIndexes =
      machineContinuationEnv.MACHINE_CONTINUATION_SLACK_SPLIT_GROUPS ?? ''
    const targetGroupIndexes = rawGroupIndexes
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value))
    expect(targetGroupIndexes.length).toBeGreaterThan(0)

    const thresholdCounts = [3, 1, 1, 0] as const
    const slackGroupIndexes = groups.flatMap((group, groupIndex) =>
      group.ingredientCost === SLACK_RECIPE_COST
        ? [groupIndex]
        : [],
    )
    expect(slackGroupIndexes.length).toBe(45)

    const identityResults = []
    let globalWitness:
      | {
          groupIndex: number
          slackGroupIndex: number
          support: number[]
          objective: number | null
        }
      | undefined

    for (const groupIndex of targetGroupIndexes) {
      const slackResults = []
      for (const slackGroupIndex of slackGroupIndexes) {
        const supportCuts: number[][] = []
        const hallCuts: number[][] = []
        let status = 'round-limit'
        let exactInfeasibleSupports = 0
        let assignmentFlow = 0
        let masterSolveMs = 0
        let exactSolveMs = 0

        for (let round = 0; round < 4; round += 1) {
          const built = build311FixedIdentitySupportMaster(
            domain,
            groupIndex,
            slackGroupIndex,
            {
              supportCuts,
              hallCuts,
              includeCustomerFlow: false,
            },
          )
          const solved = await solveBounded(built.model, 0.5)
          masterSolveMs += solved.solveMs
          if (solved.status === 'infeasible') {
            status = 'infeasible'
            break
          }
          if (
            solved.status !== 'optimal' ||
            !solved.namedSolution
          ) {
            status = solved.status
            break
          }

          const support = groups.flatMap(
            (_group, supportGroupIndex) => {
              const raw = solved.namedSolution!.get(
                `s31u_${supportGroupIndex}`,
              )
              return typeof raw === 'number' &&
                Number.isFinite(raw) &&
                raw > 0.5
                ? [supportGroupIndex]
                : []
            },
          )
          if (support.length !== 30) {
            throw new Error(
              `Expected 30 support groups for extra group ${groupIndex} / slack group ${slackGroupIndex}, got ${support.length}`,
            )
          }

          const capacities = groups.map((_group, capacityGroupIndex) => {
            const usedRaw = solved.namedSolution!.get(
              `s31u_${capacityGroupIndex}`,
            )
            const used =
              typeof usedRaw === 'number' &&
              Number.isFinite(usedRaw) &&
              usedRaw > 0.5
                ? 1
                : 0
            if (capacityGroupIndex === groupIndex) return used * 8
            const extraRaw = solved.namedSolution!.get(
              `s31e1_${capacityGroupIndex}`,
            )
            const extra =
              typeof extraRaw === 'number' &&
              Number.isFinite(extraRaw) &&
              extraRaw > 0.5
                ? 1
                : 0
            return (
              used * 2 +
              extra * 2 -
              (capacityGroupIndex === slackGroupIndex ? used : 0)
            )
          })
          const checked = maximumAssignmentFlowForGroupCapacities(
            groups,
            domain.serviceableCustomerIds,
            capacities,
          )
          assignmentFlow = checked.flow
          if (checked.flow !== domain.serviceableCustomerIds.length) {
            if (checked.violatingGroupIndexes.length === 0) {
              status = 'invalid-empty-hall-cut'
              break
            }
            hallCuts.push(checked.violatingGroupIndexes)
            continue
          }

          const exact = buildFinalizing30MaskPartitionStage(
            domain,
            new Set<ProductionStepKind>([
              'juicing',
              'seasoning',
              'blending',
            ]),
            thresholdCounts,
            { max: 76 },
            0,
            new Set(support),
            slackGroupIndex,
          )
          const exactSolved = await solveBounded(exact.model, 3)
          exactSolveMs += exactSolved.solveMs
          if (exactSolved.status === 'infeasible') {
            exactInfeasibleSupports += 1
            supportCuts.push(support)
            continue
          }
          if (exactSolved.status === 'optimal') {
            status = 'global-witness'
            globalWitness = {
              groupIndex,
              slackGroupIndex,
              support,
              objective: exactSolved.objective,
            }
            break
          }
          status = `exact-${exactSolved.status}`
          break
        }

        slackResults.push({
          slackGroupIndex,
          status,
          hallCuts: hallCuts.length,
          assignmentFlow,
          supportCuts: supportCuts.length,
          exactInfeasibleSupports,
          masterSolveMs: Math.round(masterSolveMs),
          exactSolveMs: Math.round(exactSolveMs),
        })
        if (globalWitness) break
      }

      const unresolvedSlackGroups = slackResults
        .filter((entry) => entry.status !== 'infeasible')
        .map((entry) => ({
          slackGroupIndex: entry.slackGroupIndex,
          status: entry.status,
          supportCuts: entry.supportCuts,
        }))
      const result = {
        groupIndex,
        groupCost: groups[groupIndex]?.ingredientCost ?? null,
        slackCases: slackResults.length,
        infeasibleSlackCases: slackResults.filter(
          (entry) => entry.status === 'infeasible',
        ).length,
        unresolvedSlackGroups,
        exactInfeasibleSupports: slackResults.reduce(
          (total, entry) =>
            total + entry.exactInfeasibleSupports,
          0,
        ),
        solveMs: slackResults.reduce(
          (total, entry) =>
            total + entry.masterSolveMs + entry.exactSolveMs,
          0,
        ),
      }
      identityResults.push(result)
      console.info(
        '[machine-slack-split-identity]',
        JSON.stringify(result),
      )
      if (globalWitness) break
    }

    console.info(
      '[machine-slack-split-summary]',
      JSON.stringify({
        targetGroupIndexes,
        closedIdentities: identityResults
          .filter((entry) => entry.unresolvedSlackGroups.length === 0)
          .map((entry) => entry.groupIndex),
        unresolvedIdentities: identityResults
          .filter((entry) => entry.unresolvedSlackGroups.length > 0)
          .map((entry) => entry.groupIndex),
        globalWitness,
      }),
    )

    expect(globalWitness).toBeUndefined()
    expect(
      identityResults.every(
        (entry) => entry.unresolvedSlackGroups.length === 0,
      ),
    ).toBe(true)
  },
  300000,
)

it.skip(
  'decomposes remaining finalizing-30 support frontier exactly',
  async () => {
    const domain = canonicalDomain()
    const requestedPattern =
      machineContinuationEnv.MACHINE_CONTINUATION_JOINT_PATTERN ?? '3+1+1'
    const cases = [
      { pattern: '3+1+1', thresholds: [3, 1, 1, 0] as const },
      { pattern: '2+2+1', thresholds: [3, 2, 0, 0] as const },
      { pattern: '2+1+1+1', thresholds: [4, 1, 0, 0] as const },
      { pattern: '1+1+1+1+1', thresholds: [5, 0, 0, 0] as const },
    ]
    const extraCase = cases.find(
      (candidate) => candidate.pattern === requestedPattern,
    )
    expect(extraCase).toBeDefined()
    if (!extraCase) return

    const supportCuts: number[][] = []
    let finalStatus = 'iteration-limit'

    for (let iteration = 0; iteration < 16; iteration += 1) {
      const master = buildOptimisticGroupOnlyFrontierMaster(
        domain,
        extraCase.thresholds,
        {
          includeCustomerFlow: false,
          sharedBucketMode: 'structural-signature',
          slackExtraCount: 0,
          totalNonFinalCap: 76,
          supportCuts,
        },
      )
      const masterSolved = await solveBoundedWithProgress(master.model, 4)
      if (masterSolved.status === 'infeasible') {
        finalStatus = 'infeasible'
        break
      }
      if (
        masterSolved.status !== 'optimal' ||
        !masterSolved.namedSolution
      ) {
        finalStatus = `master-${masterSolved.status}`
        break
      }

      const support = master.usedGroupVars.flatMap(
        (_usedGroup, groupIndex) => {
          const raw = masterSolved.namedSolution!.get(
            `gou_${groupIndex}`,
          )
          return typeof raw === 'number' && raw > 0.5
            ? [groupIndex]
            : []
        },
      )
      if (support.length !== 30) {
        throw new Error(
          `Expected 30 used groups, got ${support.length}`,
        )
      }

      const exact = buildFinalizing30MaskPartitionStage(
        domain,
        new Set<ProductionStepKind>([
          'juicing',
          'seasoning',
          'blending',
        ]),
        extraCase.thresholds,
        { max: 76 },
        0,
        new Set(support),
      )
      const exactSolved = await solveBoundedWithProgress(exact.model, 8)
      console.info(
        '[machine-support-decomposition-round]',
        JSON.stringify({
          pattern: extraCase.pattern,
          iteration: iteration + 1,
          supportCuts: supportCuts.length,
          masterStatus: masterSolved.status,
          exactStatus: exactSolved.status,
          exactObjective: exactSolved.objective,
          exactSolveMs: Math.round(exactSolved.solveMs),
        }),
      )

      if (exactSolved.status === 'infeasible') {
        supportCuts.push(support)
        continue
      }
      if (exactSolved.status === 'optimal') {
        finalStatus = 'feasible-support'
        break
      }
      finalStatus = `exact-${exactSolved.status}`
      break
    }

    console.info(
      '[machine-support-decomposition-summary]',
      JSON.stringify({
        pattern: extraCase.pattern,
        finalStatus,
        supportCuts: supportCuts.length,
      }),
    )
    expect(finalStatus).toBe('iteration-limit')
  },
  240000,
)


function exact311SupportArithmeticReachability(
  groups: readonly PairGroup[],
  fixedExtra3GroupIndex: number,
): {
  reachable: boolean
  stateCount: number
  classCount: number
} {
  const fixedGroup = groups[fixedExtra3GroupIndex]
  if (!fixedGroup) {
    return { reachable: false, stateCount: 0, classCount: 0 }
  }
  if (fixedGroup.eligibleCustomerIds.length < 8) {
    return { reachable: false, stateCount: 0, classCount: 0 }
  }

  const classCounts = new Map<
    string,
    {
      ingredientCost: number
      normalEligible: boolean
      extraOneEligible: boolean
      slackEligible: boolean
      count: number
    }
  >()
  groups.forEach((group, groupIndex) => {
    if (groupIndex === fixedExtra3GroupIndex) return
    const normalEligible = group.eligibleCustomerIds.length >= 2
    const extraOneEligible = group.eligibleCustomerIds.length >= 4
    const slackEligible =
      group.ingredientCost === SLACK_RECIPE_COST &&
      group.eligibleCustomerIds.length >= 1
    const key =
      `${group.ingredientCost}|${normalEligible ? 1 : 0}|${extraOneEligible ? 1 : 0}|${slackEligible ? 1 : 0}`
    const current = classCounts.get(key)
    if (current) current.count += 1
    else {
      classCounts.set(key, {
        ingredientCost: group.ingredientCost,
        normalEligible,
        extraOneEligible,
        slackEligible,
        count: 1,
      })
    }
  })

  const stateIndex = (
    selectedCount: number,
    extraOneCount: number,
    slackCount: number,
  ) => (selectedCount * 3 + extraOneCount) * 2 + slackCount
  const stateSize = 31 * 3 * 2
  const costMask =
    (1n << BigInt(PRODUCTION_COST_FIX + 1)) - 1n
  let states = Array<bigint>(stateSize).fill(0n)
  states[stateIndex(1, 0, 0)] =
    1n << BigInt(fixedGroup.ingredientCost * 4)

  for (const groupClass of classCounts.values()) {
    const options: Array<{
      selectedCount: number
      extraOneCount: number
      slackCount: number
      productionCost: number
    }> = []
    const maxExtraOne = groupClass.extraOneEligible ? 2 : 0
    for (
      let extraOneCount = 0;
      extraOneCount <= Math.min(maxExtraOne, groupClass.count);
      extraOneCount += 1
    ) {
      const maxSlack = groupClass.slackEligible ? 1 : 0
      for (
        let slackCount = 0;
        slackCount <=
        Math.min(maxSlack, groupClass.count - extraOneCount);
        slackCount += 1
      ) {
        const maxNormal = groupClass.normalEligible
          ? Math.min(
              30,
              groupClass.count - extraOneCount - slackCount,
            )
          : 0
        for (
          let normalCount = 0;
          normalCount <= maxNormal;
          normalCount += 1
        ) {
          const selectedCount =
            normalCount + extraOneCount + slackCount
          if (selectedCount === 0) continue
          options.push({
            selectedCount,
            extraOneCount,
            slackCount,
            productionCost:
              groupClass.ingredientCost *
              (normalCount + slackCount + 2 * extraOneCount),
          })
        }
      }
    }

    const next = [...states]
    for (let selectedCount = 1; selectedCount <= 30; selectedCount += 1) {
      for (let extraOneCount = 0; extraOneCount <= 2; extraOneCount += 1) {
        for (let slackCount = 0; slackCount <= 1; slackCount += 1) {
          const source =
            states[stateIndex(
              selectedCount,
              extraOneCount,
              slackCount,
            )]
          if (source === 0n) continue
          for (const option of options) {
            const nextSelected =
              selectedCount + option.selectedCount
            const nextExtraOne =
              extraOneCount + option.extraOneCount
            const nextSlack = slackCount + option.slackCount
            if (
              nextSelected > 30 ||
              nextExtraOne > 2 ||
              nextSlack > 1
            ) {
              continue
            }
            const shifted =
              (source << BigInt(option.productionCost)) & costMask
            if (shifted === 0n) continue
            const targetIndex = stateIndex(
              nextSelected,
              nextExtraOne,
              nextSlack,
            )
            next[targetIndex] |= shifted
          }
        }
      }
    }
    states = next
  }

  const terminal = states[stateIndex(30, 2, 1)]
  const targetBit = 1n << BigInt(PRODUCTION_COST_FIX)
  return {
    reachable: (terminal & targetBit) !== 0n,
    stateCount: states.filter((state) => state !== 0n).length,
    classCount: classCounts.size,
  }
}

function exact311MaskCapacityReachability(
  groups: readonly PairGroup[],
  fixedExtra3GroupIndex: number,
): {
  reachable: boolean
  fixedMaskSize: number
  sameMaskGroupCount: number
  maskCount: number
} {
  const fixedGroup = groups[fixedExtra3GroupIndex]
  if (!fixedGroup || fixedGroup.eligibleCustomerIds.length < 8) {
    return {
      reachable: false,
      fixedMaskSize: fixedGroup?.eligibleCustomerIds.length ?? 0,
      sameMaskGroupCount: 0,
      maskCount: 0,
    }
  }

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const key = maskKeyForGroup(group)
    const indexes = groupIndexesByMask.get(key)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(key, [groupIndex])
  })

  type LocalOption = {
    selectedCount: number
    extraOneCount: number
    slackCount: number
    productionCost: number
    capacity: number
  }

  const localOptionsByMask: LocalOption[][] = []
  for (const groupIndexes of groupIndexesByMask.values()) {
    const maskSize = groups[groupIndexes[0]].eligibleCustomerIds.length
    let local = new Map<string, LocalOption>([
      [
        '0|0|0|0|0',
        {
          selectedCount: 0,
          extraOneCount: 0,
          slackCount: 0,
          productionCost: 0,
          capacity: 0,
        },
      ],
    ])

    for (const groupIndex of groupIndexes) {
      const group = groups[groupIndex]
      const roleOptions: LocalOption[] =
        groupIndex === fixedExtra3GroupIndex
          ? [{
              selectedCount: 1,
              extraOneCount: 0,
              slackCount: 0,
              productionCost: group.ingredientCost * 4,
              capacity: 8,
            }]
          : [
              {
                selectedCount: 0,
                extraOneCount: 0,
                slackCount: 0,
                productionCost: 0,
                capacity: 0,
              },
              ...(group.eligibleCustomerIds.length >= 2
                ? [{
                    selectedCount: 1,
                    extraOneCount: 0,
                    slackCount: 0,
                    productionCost: group.ingredientCost,
                    capacity: 2,
                  }]
                : []),
              ...(group.eligibleCustomerIds.length >= 4
                ? [{
                    selectedCount: 1,
                    extraOneCount: 1,
                    slackCount: 0,
                    productionCost: group.ingredientCost * 2,
                    capacity: 4,
                  }]
                : []),
              ...(group.ingredientCost === SLACK_RECIPE_COST
                ? [{
                    selectedCount: 1,
                    extraOneCount: 0,
                    slackCount: 1,
                    productionCost: group.ingredientCost,
                    capacity: 1,
                  }]
                : []),
            ]

      const next = new Map<string, LocalOption>()
      for (const existing of local.values()) {
        for (const role of roleOptions) {
          const candidate: LocalOption = {
            selectedCount:
              existing.selectedCount + role.selectedCount,
            extraOneCount:
              existing.extraOneCount + role.extraOneCount,
            slackCount:
              existing.slackCount + role.slackCount,
            productionCost:
              existing.productionCost + role.productionCost,
            capacity: existing.capacity + role.capacity,
          }
          if (
            candidate.selectedCount > 30 ||
            candidate.extraOneCount > 2 ||
            candidate.slackCount > 1 ||
            candidate.productionCost > PRODUCTION_COST_FIX ||
            candidate.capacity > maskSize
          ) {
            continue
          }
          const key =
            `${candidate.selectedCount}|${candidate.extraOneCount}|${candidate.slackCount}|${candidate.productionCost}|${candidate.capacity}`
          next.set(key, candidate)
        }
      }
      local = next
      if (local.size === 0) break
    }
    if (local.size === 0) {
      return {
        reachable: false,
        fixedMaskSize: fixedGroup.eligibleCustomerIds.length,
        sameMaskGroupCount:
          groupIndexesByMask.get(maskKeyForGroup(fixedGroup))?.length ?? 0,
        maskCount: groupIndexesByMask.size,
      }
    }
    localOptionsByMask.push([...local.values()])
  }

  const stateIndex = (
    selectedCount: number,
    extraOneCount: number,
    slackCount: number,
  ) => (selectedCount * 3 + extraOneCount) * 2 + slackCount
  const stateSize = 31 * 3 * 2
  const costMask =
    (1n << BigInt(PRODUCTION_COST_FIX + 1)) - 1n
  let states = Array<bigint>(stateSize).fill(0n)
  states[stateIndex(0, 0, 0)] = 1n

  for (const localOptions of localOptionsByMask) {
    const next = Array<bigint>(stateSize).fill(0n)
    for (let selectedCount = 0; selectedCount <= 30; selectedCount += 1) {
      for (let extraOneCount = 0; extraOneCount <= 2; extraOneCount += 1) {
        for (let slackCount = 0; slackCount <= 1; slackCount += 1) {
          const source =
            states[stateIndex(
              selectedCount,
              extraOneCount,
              slackCount,
            )]
          if (source === 0n) continue
          for (const option of localOptions) {
            const nextSelected =
              selectedCount + option.selectedCount
            const nextExtraOne =
              extraOneCount + option.extraOneCount
            const nextSlack = slackCount + option.slackCount
            if (
              nextSelected > 30 ||
              nextExtraOne > 2 ||
              nextSlack > 1
            ) {
              continue
            }
            const shifted =
              (source << BigInt(option.productionCost)) & costMask
            if (shifted === 0n) continue
            next[
              stateIndex(
                nextSelected,
                nextExtraOne,
                nextSlack,
              )
            ] |= shifted
          }
        }
      }
    }
    states = next
  }

  const terminal = states[stateIndex(30, 2, 1)]
  const targetBit = 1n << BigInt(PRODUCTION_COST_FIX)
  const fixedMaskKey = maskKeyForGroup(fixedGroup)
  return {
    reachable: (terminal & targetBit) !== 0n,
    fixedMaskSize: fixedGroup.eligibleCustomerIds.length,
    sameMaskGroupCount:
      groupIndexesByMask.get(fixedMaskKey)?.length ?? 0,
    maskCount: groupIndexesByMask.size,
  }
}

async function find311MaskCapacitySupportWitness(
  groups: readonly PairGroup[],
  fixedExtra3GroupIndex: number,
  hallCutGroupIndexes: readonly number[] = [],
  hallCutGroupIndexes2: readonly number[] = [],
  yieldEveryMasks = 0,
): Promise<{
  support: number[]
  capacities: number[]
} | null> {
  const fixedGroup = groups[fixedExtra3GroupIndex]
  if (!fixedGroup || fixedGroup.eligibleCustomerIds.length < 8) {
    return null
  }

  const yieldToEventLoop = () =>
    new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 0)
    })

  const hallCutSet = new Set(hallCutGroupIndexes)
  const hallCustomerIds = new Set<string>()
  for (const groupIndex of hallCutGroupIndexes) {
    for (const customerId of groups[groupIndex]?.eligibleCustomerIds ?? []) {
      hallCustomerIds.add(customerId)
    }
  }
  const hallLimit =
    hallCutGroupIndexes.length > 0 ? hallCustomerIds.size : 0
  const hallCutSet2 = new Set(hallCutGroupIndexes2)
  const hallCustomerIds2 = new Set<string>()
  for (const groupIndex of hallCutGroupIndexes2) {
    for (const customerId of groups[groupIndex]?.eligibleCustomerIds ?? []) {
      hallCustomerIds2.add(customerId)
    }
  }
  const hallLimit2 =
    hallCutGroupIndexes2.length > 0 ? hallCustomerIds2.size : 0

  const maskKeyForGroup = (group: PairGroup) =>
    group.eligibleCustomerIds.join('\u001e')
  const groupIndexesByMask = new Map<string, number[]>()
  groups.forEach((group, groupIndex) => {
    const key = maskKeyForGroup(group)
    const indexes = groupIndexesByMask.get(key)
    if (indexes) indexes.push(groupIndex)
    else groupIndexesByMask.set(key, [groupIndex])
  })

  type WitnessLocalOption = {
    selectedCount: number
    extraOneCount: number
    slackCount: number
    productionCost: number
    capacity: number
    hallCapacity: number
    hallCapacity2: number
    capacities: Array<[number, number]>
  }

  const localOptionsByMask: WitnessLocalOption[][] = []
  for (const groupIndexes of groupIndexesByMask.values()) {
    const maskSize = groups[groupIndexes[0]].eligibleCustomerIds.length
    let local = new Map<string, WitnessLocalOption>([
      [
        '0|0|0|0|0',
        {
          selectedCount: 0,
          extraOneCount: 0,
          slackCount: 0,
          productionCost: 0,
          capacity: 0,
          hallCapacity: 0,
          hallCapacity2: 0,
          capacities: [],
        },
      ],
    ])

    for (const groupIndex of groupIndexes) {
      const group = groups[groupIndex]
      const roleOptions: WitnessLocalOption[] =
        groupIndex === fixedExtra3GroupIndex
          ? [{
              selectedCount: 1,
              extraOneCount: 0,
              slackCount: 0,
              productionCost: group.ingredientCost * 4,
              capacity: 8,
              hallCapacity: hallCutSet.has(groupIndex) ? 8 : 0,
              hallCapacity2: hallCutSet2.has(groupIndex) ? 8 : 0,
              capacities: [[groupIndex, 8]],
            }]
          : [
              {
                selectedCount: 0,
                extraOneCount: 0,
                slackCount: 0,
                productionCost: 0,
                capacity: 0,
                hallCapacity: 0,
                hallCapacity2: 0,
                capacities: [],
              },
              ...(group.eligibleCustomerIds.length >= 2
                ? [{
                    selectedCount: 1,
                    extraOneCount: 0,
                    slackCount: 0,
                    productionCost: group.ingredientCost,
                    capacity: 2,
                    hallCapacity: hallCutSet.has(groupIndex) ? 2 : 0,
                    hallCapacity2: hallCutSet2.has(groupIndex) ? 2 : 0,
                    capacities: [[groupIndex, 2]] as Array<[number, number]>,
                  }]
                : []),
              ...(group.eligibleCustomerIds.length >= 4
                ? [{
                    selectedCount: 1,
                    extraOneCount: 1,
                    slackCount: 0,
                    productionCost: group.ingredientCost * 2,
                    capacity: 4,
                    hallCapacity: hallCutSet.has(groupIndex) ? 4 : 0,
                    hallCapacity2: hallCutSet2.has(groupIndex) ? 4 : 0,
                    capacities: [[groupIndex, 4]] as Array<[number, number]>,
                  }]
                : []),
              ...(group.ingredientCost === SLACK_RECIPE_COST
                ? [{
                    selectedCount: 1,
                    extraOneCount: 0,
                    slackCount: 1,
                    productionCost: group.ingredientCost,
                    capacity: 1,
                    hallCapacity: hallCutSet.has(groupIndex) ? 1 : 0,
                    hallCapacity2: hallCutSet2.has(groupIndex) ? 1 : 0,
                    capacities: [[groupIndex, 1]] as Array<[number, number]>,
                  }]
                : []),
            ]

      const next = new Map<string, WitnessLocalOption>()
      for (const existing of local.values()) {
        for (const role of roleOptions) {
          const candidate: WitnessLocalOption = {
            selectedCount:
              existing.selectedCount + role.selectedCount,
            extraOneCount:
              existing.extraOneCount + role.extraOneCount,
            slackCount:
              existing.slackCount + role.slackCount,
            productionCost:
              existing.productionCost + role.productionCost,
            capacity: existing.capacity + role.capacity,
            hallCapacity:
              existing.hallCapacity + role.hallCapacity,
            hallCapacity2:
              existing.hallCapacity2 + role.hallCapacity2,
            capacities: [
              ...existing.capacities,
              ...role.capacities,
            ],
          }
          if (
            candidate.selectedCount > 30 ||
            candidate.extraOneCount > 2 ||
            candidate.slackCount > 1 ||
            candidate.productionCost > PRODUCTION_COST_FIX ||
            candidate.capacity > maskSize ||
            candidate.hallCapacity > hallLimit ||
            candidate.hallCapacity2 > hallLimit2
          ) {
            continue
          }
          const key =
            `${candidate.selectedCount}|${candidate.extraOneCount}|${candidate.slackCount}|${candidate.productionCost}|${candidate.capacity}|${candidate.hallCapacity}|${candidate.hallCapacity2}`
          if (!next.has(key)) next.set(key, candidate)
        }
      }
      local = next
      if (local.size === 0) return null
    }
    localOptionsByMask.push([...local.values()])
  }

  const stateIndex = (
    selectedCount: number,
    extraOneCount: number,
    slackCount: number,
    hallCapacity: number,
    hallCapacity2: number,
  ) =>
    ((((selectedCount * 3 + extraOneCount) * 2 + slackCount) *
      (hallLimit + 1) +
      hallCapacity) *
      (hallLimit2 + 1)) +
    hallCapacity2
  const stateSize =
    31 * 3 * 2 * (hallLimit + 1) * (hallLimit2 + 1)
  const costMask =
    (1n << BigInt(PRODUCTION_COST_FIX + 1)) - 1n
  const hallCapacitySize = hallLimit + 1
  const hallCapacity2Size = hallLimit2 + 1
  const decodeStateIndex = (encoded: number) => {
    let remainder = encoded
    const hallCapacity2 = remainder % hallCapacity2Size
    remainder = Math.floor(remainder / hallCapacity2Size)
    const hallCapacity = remainder % hallCapacitySize
    remainder = Math.floor(remainder / hallCapacitySize)
    const slackCount = remainder % 2
    remainder = Math.floor(remainder / 2)
    const extraOneCount = remainder % 3
    const selectedCount = Math.floor(remainder / 3)
    return {
      selectedCount,
      extraOneCount,
      slackCount,
      hallCapacity,
      hallCapacity2,
    }
  }
  type ActiveDpState = {
    bits: bigint[]
    activeIndexes: number[]
  }
  const advanceStates = (
    sourceState: ActiveDpState,
    localOptions: readonly WitnessLocalOption[],
  ): ActiveDpState => {
    const nextBits = Array<bigint>(stateSize).fill(0n)
    const nextActiveIndexes: number[] = []
    for (const encoded of sourceState.activeIndexes) {
      const source = sourceState.bits[encoded]
      const decoded = decodeStateIndex(encoded)
      for (const option of localOptions) {
        const nextSelected =
          decoded.selectedCount + option.selectedCount
        const nextExtraOne =
          decoded.extraOneCount + option.extraOneCount
        const nextSlack =
          decoded.slackCount + option.slackCount
        const nextHall =
          decoded.hallCapacity + option.hallCapacity
        const nextHall2 =
          decoded.hallCapacity2 + option.hallCapacity2
        if (
          nextSelected > 30 ||
          nextExtraOne > 2 ||
          nextSlack > 1 ||
          nextHall > hallLimit ||
          nextHall2 > hallLimit2
        ) {
          continue
        }
        const shifted =
          (source << BigInt(option.productionCost)) & costMask
        if (shifted === 0n) continue
        const targetIndex = stateIndex(
          nextSelected,
          nextExtraOne,
          nextSlack,
          nextHall,
          nextHall2,
        )
        const previous = nextBits[targetIndex]
        if (previous === 0n) {
          nextActiveIndexes.push(targetIndex)
        }
        nextBits[targetIndex] = previous | shifted
      }
    }
    return {
      bits: nextBits,
      activeIndexes: nextActiveIndexes,
    }
  }

  const initialBits = Array<bigint>(stateSize).fill(0n)
  const initialIndex = stateIndex(0, 0, 0, 0, 0)
  initialBits[initialIndex] = 1n
  let states: ActiveDpState = {
    bits: initialBits,
    activeIndexes: [initialIndex],
  }
  const checkpointStride = 32
  const checkpoints = new Map<number, ActiveDpState>([
    [0, states],
  ])

  for (
    let maskIndex = 0;
    maskIndex < localOptionsByMask.length;
    maskIndex += 1
  ) {
    states = advanceStates(states, localOptionsByMask[maskIndex])
    const processedMaskCount = maskIndex + 1
    if (
      processedMaskCount % checkpointStride === 0 ||
      processedMaskCount === localOptionsByMask.length
    ) {
      checkpoints.set(processedMaskCount, states)
    }
    if (
      yieldEveryMasks > 0 &&
      processedMaskCount % yieldEveryMasks === 0
    ) {
      await yieldToEventLoop()
    }
  }

  const targetBit = 1n << BigInt(PRODUCTION_COST_FIX)
  let hallCapacity = -1
  let hallCapacity2 = -1
  outer:
  for (
    let candidateHall = 0;
    candidateHall <= hallLimit;
    candidateHall += 1
  ) {
    for (
      let candidateHall2 = 0;
      candidateHall2 <= hallLimit2;
      candidateHall2 += 1
    ) {
      if (
        (states.bits[
          stateIndex(
            30,
            2,
            1,
            candidateHall,
            candidateHall2,
          )
        ] & targetBit) !== 0n
      ) {
        hallCapacity = candidateHall
        hallCapacity2 = candidateHall2
        break outer
      }
    }
  }
  if (hallCapacity < 0 || hallCapacity2 < 0) return null

  let selectedCount = 30
  let extraOneCount = 2
  let slackCount = 1
  let productionCost = PRODUCTION_COST_FIX
  const chosenOptions: WitnessLocalOption[] = []
  let maskIndex = localOptionsByMask.length - 1

  while (maskIndex >= 0) {
    const blockStart =
      Math.floor(maskIndex / checkpointStride) * checkpointStride
    const blockEnd = Math.min(
      blockStart + checkpointStride,
      localOptionsByMask.length,
    )
    const checkpoint = checkpoints.get(blockStart)
    if (!checkpoint) {
      throw new Error(
        `Missing support DP checkpoint at mask ${blockStart}`,
      )
    }
    const blockSnapshots: ActiveDpState[] = [checkpoint]
    let blockState = checkpoint
    for (
      let forwardIndex = blockStart;
      forwardIndex < blockEnd;
      forwardIndex += 1
    ) {
      blockState = advanceStates(
        blockState,
        localOptionsByMask[forwardIndex],
      )
      blockSnapshots.push(blockState)
      if (
        yieldEveryMasks > 0 &&
        (forwardIndex - blockStart + 1) % yieldEveryMasks === 0
      ) {
        await yieldToEventLoop()
      }
    }

    for (; maskIndex >= blockStart; maskIndex -= 1) {
      const previous = blockSnapshots[maskIndex - blockStart]
      let chosen: WitnessLocalOption | undefined
      for (const option of localOptionsByMask[maskIndex]) {
        const sourceSelected =
          selectedCount - option.selectedCount
        const sourceExtraOne =
          extraOneCount - option.extraOneCount
        const sourceSlack = slackCount - option.slackCount
        const sourceCost =
          productionCost - option.productionCost
        const sourceHall =
          hallCapacity - option.hallCapacity
        const sourceHall2 =
          hallCapacity2 - option.hallCapacity2
        if (
          sourceSelected < 0 ||
          sourceExtraOne < 0 ||
          sourceSlack < 0 ||
          sourceCost < 0 ||
          sourceHall < 0 ||
          sourceHall2 < 0
        ) {
          continue
        }
        const sourceBits =
          previous.bits[
            stateIndex(
              sourceSelected,
              sourceExtraOne,
              sourceSlack,
              sourceHall,
              sourceHall2,
            )
          ]
        if (
          (sourceBits & (1n << BigInt(sourceCost))) === 0n
        ) {
          continue
        }
        chosen = option
        selectedCount = sourceSelected
        extraOneCount = sourceExtraOne
        slackCount = sourceSlack
        productionCost = sourceCost
        hallCapacity = sourceHall
        hallCapacity2 = sourceHall2
        chosenOptions.push(option)
        break
      }
      if (!chosen) {
        throw new Error(
          `Failed to backtrack support DP at mask ${maskIndex}`,
        )
      }
    }
  }

  if (
    selectedCount !== 0 ||
    extraOneCount !== 0 ||
    slackCount !== 0 ||
    productionCost !== 0 ||
    hallCapacity !== 0 ||
    hallCapacity2 !== 0
  ) {
    throw new Error('Support DP backtrack did not reach origin')
  }

  const capacities = Array(groups.length).fill(0)
  for (const option of chosenOptions) {
    for (const [groupIndex, capacity] of option.capacities) {
      capacities[groupIndex] = capacity
    }
  }
  const support = capacities.flatMap((capacity, groupIndex) =>
    capacity > 0 ? [groupIndex] : [],
  )
  if (support.length !== 30) {
    throw new Error(
      `Expected 30 groups from support DP, got ${support.length}`,
    )
  }
  return { support, capacities }
}

async function bootstrap311HallCutsFromDpWitnesses(
  domain: BatchOptimizationModel,
  groups: readonly PairGroup[],
): Promise<number[][]> {
  const cuts: number[][] = []
  const keys = new Set<string>()
  for (const groupIndex of UNRESOLVED_311_EXTRA3_GROUP_INDEXES) {
    const witness = await find311MaskCapacitySupportWitness(
      groups,
      groupIndex,
    )
    if (!witness) continue
    const checked = maximumAssignmentFlowForGroupCapacities(
      groups,
      domain.serviceableCustomerIds,
      witness.capacities,
    )
    if (
      checked.flow === domain.serviceableCustomerIds.length ||
      checked.violatingGroupIndexes.length === 0
    ) {
      continue
    }
    const key = checked.violatingGroupIndexes.join(',')
    if (keys.has(key)) continue
    keys.add(key)
    cuts.push(checked.violatingGroupIndexes)
  }
  return cuts
}

hallSignatureProfileIt(
  'profiles Hall-closure membership signatures for unresolved 3+1+1 support',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const cuts = await bootstrap311HallCutsFromDpWitnesses(domain, groups)
    const cutSets = cuts.map((cut) => new Set(cut))
    const signatureCounts = new Map<string, number>()
    const classCounts = new Map<string, number>()

    groups.forEach((group, groupIndex) => {
      const signature = cutSets
        .map((cut) => (cut.has(groupIndex) ? '1' : '0'))
        .join('')
      signatureCounts.set(
        signature,
        (signatureCounts.get(signature) ?? 0) + 1,
      )
      const roleClass =
        `${group.ingredientCost}|${group.eligibleCustomerIds.length >= 2 ? 1 : 0}|${group.eligibleCustomerIds.length >= 4 ? 1 : 0}|${group.ingredientCost === SLACK_RECIPE_COST ? 1 : 0}|${signature}`
      classCounts.set(roleClass, (classCounts.get(roleClass) ?? 0) + 1)
    })

    const cutRows = cuts.map((cut, cutIndex) => {
      const customerIds = new Set<string>()
      for (const groupIndex of cut) {
        for (const customerId of groups[groupIndex]?.eligibleCustomerIds ?? []) {
          customerIds.add(customerId)
        }
      }
      return {
        cutIndex,
        groupCount: cut.length,
        customerCount: customerIds.size,
      }
    })

    console.info(
      '[machine-hall-signature-summary]',
      JSON.stringify({
        groupCount: groups.length,
        cutCount: cuts.length,
        signatureCount: signatureCounts.size,
        roleSignatureClassCount: classCounts.size,
        largestSignatures: [...signatureCounts.entries()]
          .map(([signature, count]) => ({ signature, count }))
          .sort((left, right) => right.count - left.count)
          .slice(0, 20),
        cuts: cutRows,
      }),
    )

    const fixedGroupIndex = 1279
    const fixedCustomers = new Set(
      groups[fixedGroupIndex]?.eligibleCustomerIds ?? [],
    )
    const extraOneCandidates = groups.flatMap((group, groupIndex) => {
      if (groupIndex === fixedGroupIndex) return []
      const residualCustomerIds = group.eligibleCustomerIds.filter(
        (customerId) => !fixedCustomers.has(customerId),
      )
      return residualCustomerIds.length >= 4
        ? [{
            groupIndex,
            ingredientCost: group.ingredientCost,
            residualCustomerIds,
          }]
        : []
    })
    let pairCount = 0
    const pairCostSums = new Map<number, number>()
    let tightPairCount = 0
    for (let leftIndex = 0; leftIndex < extraOneCandidates.length; leftIndex += 1) {
      const left = extraOneCandidates[leftIndex]
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < extraOneCandidates.length;
        rightIndex += 1
      ) {
        const right = extraOneCandidates[rightIndex]
        const union = new Set([
          ...left.residualCustomerIds,
          ...right.residualCustomerIds,
        ])
        if (union.size < 8) continue
        pairCount += 1
        if (union.size === 8) tightPairCount += 1
        const costSum = left.ingredientCost + right.ingredientCost
        pairCostSums.set(costSum, (pairCostSums.get(costSum) ?? 0) + 1)
      }
    }
    console.info(
      '[machine-extra1-pair-summary]',
      JSON.stringify({
        fixedGroupIndex,
        fixedCustomerCount: fixedCustomers.size,
        extraOneCandidateCount: extraOneCandidates.length,
        pairCount,
        tightPairCount,
        costSumCaseCount: pairCostSums.size,
        smallestPairCostSums: [...pairCostSums.entries()]
          .sort(([left], [right]) => left - right)
          .slice(0, 20)
          .map(([costSum, count]) => ({ costSum, count })),
        largestPairCostBuckets: [...pairCostSums.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 20)
          .map(([costSum, count]) => ({ costSum, count })),
      }),
    )
  },
  120000,
)


function build311HallSignatureSupportMaster(
  groups: readonly PairGroup[],
  fixedExtra3GroupIndex: number,
  hallCuts: readonly (readonly number[])[],
) {
  const fixedGroup = groups[fixedExtra3GroupIndex]
  const model = new Model()
  if (!fixedGroup || fixedGroup.eligibleCustomerIds.length < 8) {
    model.addConstraint(
      model.intVar(0, 0, 'invalid').geq(1),
      'invalid_fixed_group',
    )
    return { model, classes: [] as Array<{ groupIndexes: number[]; normalName: string; extraName: string; slackName: string }> }
  }

  const cutSets = hallCuts.map((cut) => new Set(cut))
  const forcedCustomerIds =
    fixedGroup.eligibleCustomerIds.length === 8
      ? new Set(fixedGroup.eligibleCustomerIds)
      : null
  const classMap = new Map<
    string,
    {
      ingredientCost: number
      normalEligible: boolean
      extraEligible: boolean
      slackEligible: boolean
      signature: string
      groupIndexes: number[]
    }
  >()

  groups.forEach((group, groupIndex) => {
    if (groupIndex === fixedExtra3GroupIndex) return
    const remainingEligibleCount = forcedCustomerIds
      ? group.eligibleCustomerIds.filter(
          (customerId) => !forcedCustomerIds.has(customerId),
        ).length
      : group.eligibleCustomerIds.length
    const normalEligible = remainingEligibleCount >= 2
    const extraEligible = remainingEligibleCount >= 4
    const slackEligible =
      group.ingredientCost === SLACK_RECIPE_COST &&
      remainingEligibleCount >= 1
    const signature = cutSets
      .map((cut) => (cut.has(groupIndex) ? '1' : '0'))
      .join('')
    const key =
      `${group.ingredientCost}|${normalEligible ? 1 : 0}|${extraEligible ? 1 : 0}|${slackEligible ? 1 : 0}|${signature}`
    const current = classMap.get(key)
    if (current) current.groupIndexes.push(groupIndex)
    else {
      classMap.set(key, {
        ingredientCost: group.ingredientCost,
        normalEligible,
        extraEligible,
        slackEligible,
        signature,
        groupIndexes: [groupIndex],
      })
    }
  })

  const selectedTerms = []
  const extraTerms = []
  const slackTerms = []
  const costTerms = []
  const hallTerms: Array<Array<ReturnType<typeof sum>>> =
    hallCuts.map(() => [])
  const classes: Array<{
    groupIndexes: number[]
    normalName: string
    extraName: string
    slackName: string
  }> = []

  let classIndex = 0
  for (const groupClass of classMap.values()) {
    const count = groupClass.groupIndexes.length
    const normalName = `hsa_n_${classIndex}`
    const extraName = `hsa_e_${classIndex}`
    const slackName = `hsa_s_${classIndex}`
    const normal = model.intVar(
      0,
      groupClass.normalEligible ? count : 0,
      normalName,
    )
    const extra = model.intVar(
      0,
      groupClass.extraEligible ? Math.min(2, count) : 0,
      extraName,
    )
    const slack = model.intVar(
      0,
      groupClass.slackEligible ? 1 : 0,
      slackName,
    )
    model.addConstraint(
      sum(normal, extra, slack).leq(count),
      `hsa_class_count_${classIndex}`,
    )
    selectedTerms.push(normal, extra, slack)
    extraTerms.push(extra)
    slackTerms.push(slack)
    costTerms.push(
      normal.times(groupClass.ingredientCost),
      extra.times(groupClass.ingredientCost * 2),
      slack.times(groupClass.ingredientCost),
    )
    hallCuts.forEach((_cut, cutIndex) => {
      if (groupClass.signature[cutIndex] !== '1') return
      hallTerms[cutIndex].push(
        normal.times(2),
        extra.times(4),
        slack.times(1),
      )
    })
    classes.push({
      groupIndexes: groupClass.groupIndexes,
      normalName,
      extraName,
      slackName,
    })
    classIndex += 1
  }

  model.addConstraint(
    sum(...selectedTerms).eq(29),
    'hsa_selected_groups',
  )
  model.addConstraint(sum(...extraTerms).eq(2), 'hsa_extra_one')
  model.addConstraint(sum(...slackTerms).eq(1), 'hsa_slack')
  model.addConstraint(
    sum(...costTerms).eq(
      PRODUCTION_COST_FIX - fixedGroup.ingredientCost * 4,
    ),
    'hsa_production_cost',
  )

  hallCuts.forEach((cut, cutIndex) => {
    const customerIds = new Set<string>()
    for (const groupIndex of cut) {
      if (groupIndex === fixedExtra3GroupIndex) continue
      for (const customerId of groups[groupIndex]?.eligibleCustomerIds ?? []) {
        if (forcedCustomerIds?.has(customerId)) continue
        customerIds.add(customerId)
      }
    }
    const fixedCapacity = forcedCustomerIds
      ? 0
      : cutSets[cutIndex].has(fixedExtra3GroupIndex)
        ? 8
        : 0
    model.addConstraint(
      sum(...hallTerms[cutIndex]).leq(customerIds.size - fixedCapacity),
      `hsa_hall_${cutIndex}`,
    )
  })

  return { model, classes }
}

hallSignatureProfileIt(
  'prefilters all unresolved 3+1+1 identities with exact Hall-signature cuts',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const hallCuts = await bootstrap311HallCutsFromDpWitnesses(domain, groups)
    const results = []

    for (const groupIndex of UNRESOLVED_311_EXTRA3_GROUP_INDEXES) {
      const built = build311HallSignatureSupportMaster(
        groups,
        groupIndex,
        hallCuts,
      )
      const solved = await solveBounded(built.model, 0.5)
      results.push({
        groupIndex,
        groupCost: groups[groupIndex]?.ingredientCost ?? null,
        eligibleCustomers:
          groups[groupIndex]?.eligibleCustomerIds.length ?? null,
        classCount: built.classes.length,
        status: solved.status,
        solveMs: Math.round(solved.solveMs),
      })
    }

    console.info(
      '[machine-hall-signature-prefilter-summary]',
      JSON.stringify({
        hallCuts: hallCuts.length,
        closedIdentities: results
          .filter((entry) => entry.status === 'infeasible')
          .map((entry) => entry.groupIndex),
        unresolvedIdentities: results
          .filter((entry) => entry.status !== 'infeasible')
          .map((entry) => entry.groupIndex),
        results,
      }),
    )
  },
  120000,
)

hallSignatureProfileIt(
  'iterates exact Hall-signature support classes for one unresolved identity',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const groupIndex = 1279
    const hallCuts = await bootstrap311HallCutsFromDpWitnesses(domain, groups)
    const hallCutKeys = new Set(hallCuts.map((cut) => cut.join(',')))
    const thresholdCounts = [3, 1, 1, 0] as const
    const rounds = []

    for (let round = 0; round < 64; round += 1) {
      const built = build311HallSignatureSupportMaster(
        groups,
        groupIndex,
        hallCuts,
      )
      const solved = await solveBounded(built.model, 1)
      if (solved.status !== 'optimal' || !solved.namedSolution) {
        rounds.push({
          round: round + 1,
          status: solved.status,
          hallCuts: hallCuts.length,
          classCount: built.classes.length,
          solveMs: Math.round(solved.solveMs),
        })
        break
      }

      const capacities = Array(groups.length).fill(0)
      capacities[groupIndex] = 8
      for (const groupClass of built.classes) {
        const normalRaw = solved.namedSolution.get(groupClass.normalName)
        const extraRaw = solved.namedSolution.get(groupClass.extraName)
        const slackRaw = solved.namedSolution.get(groupClass.slackName)
        const normalCount =
          typeof normalRaw === 'number' ? Math.round(normalRaw) : 0
        const extraCount =
          typeof extraRaw === 'number' ? Math.round(extraRaw) : 0
        const slackCount =
          typeof slackRaw === 'number' ? Math.round(slackRaw) : 0
        const available = [...groupClass.groupIndexes]
        for (let index = 0; index < extraCount; index += 1) {
          const chosen = available.shift()
          if (chosen === undefined) throw new Error('Missing extra group')
          capacities[chosen] = 4
        }
        for (let index = 0; index < slackCount; index += 1) {
          const chosen = available.shift()
          if (chosen === undefined) throw new Error('Missing slack group')
          capacities[chosen] = 1
        }
        for (let index = 0; index < normalCount; index += 1) {
          const chosen = available.shift()
          if (chosen === undefined) throw new Error('Missing normal group')
          capacities[chosen] = 2
        }
      }

      const support = capacities.flatMap((capacity, supportGroupIndex) =>
        capacity > 0 ? [supportGroupIndex] : [],
      )
      if (support.length !== 30) {
        throw new Error(
          `Expected 30 Hall-signature support groups, got ${support.length}`,
        )
      }
      const fixedCustomerIds = new Set(
        groups[groupIndex].eligibleCustomerIds,
      )
      const residualGroups =
        fixedCustomerIds.size === 8
          ? groups.map((group, residualGroupIndex) => ({
              ...group,
              eligibleCustomerIds:
                residualGroupIndex === groupIndex
                  ? []
                  : group.eligibleCustomerIds.filter(
                      (customerId) => !fixedCustomerIds.has(customerId),
                    ),
            }))
          : groups
      const residualCustomerIds =
        fixedCustomerIds.size === 8
          ? domain.serviceableCustomerIds.filter(
              (customerId) => !fixedCustomerIds.has(customerId),
            )
          : domain.serviceableCustomerIds
      const residualCapacities =
        fixedCustomerIds.size === 8
          ? capacities.map((capacity, residualGroupIndex) =>
              residualGroupIndex === groupIndex ? 0 : capacity,
            )
          : capacities
      const checked = maximumAssignmentFlowForGroupCapacities(
        residualGroups,
        residualCustomerIds,
        residualCapacities,
      )
      const targetFlow = residualCustomerIds.length

      if (checked.flow < targetFlow) {
        const key = checked.violatingGroupIndexes.join(',')
        rounds.push({
          round: round + 1,
          status: 'hall-cut',
          hallCuts: hallCuts.length,
          classCount: built.classes.length,
          solveMs: Math.round(solved.solveMs),
          assignmentFlow:
            checked.flow + (fixedCustomerIds.size === 8 ? 8 : 0),
          newCutGroups: checked.violatingGroupIndexes.length,
        })
        if (
          checked.violatingGroupIndexes.length === 0 ||
          hallCutKeys.has(key)
        ) {
          break
        }
        hallCutKeys.add(key)
        hallCuts.push(checked.violatingGroupIndexes)
        continue
      }

      const exact = buildFinalizing30MaskPartitionStage(
        domain,
        new Set<ProductionStepKind>([
          'juicing',
          'seasoning',
          'blending',
        ]),
        thresholdCounts,
        { max: 76 },
        0,
        new Set(support),
      )
      const exactSolved = await solveBounded(exact.model, 3)
      rounds.push({
        round: round + 1,
        status: `customer-feasible-${exactSolved.status}`,
        hallCuts: hallCuts.length,
        classCount: built.classes.length,
        solveMs: Math.round(solved.solveMs),
        assignmentFlow:
          checked.flow + (fixedCustomerIds.size === 8 ? 8 : 0),
        exactSolveMs: Math.round(exactSolved.solveMs),
      })
      break
    }

    console.info(
      '[machine-hall-signature-master-summary]',
      JSON.stringify({ groupIndex, rounds }),
    )
  },
  120000,
)

supportDpProfileIt(
  'counts exact 3+1+1 support roles before customer-flow validation',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const rawGroupIndexes =
      machineContinuationEnv.MACHINE_CONTINUATION_SUPPORT_DP_GROUPS ?? ''
    const targetGroupIndexes = rawGroupIndexes
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value))
    expect(targetGroupIndexes.length).toBeGreaterThan(0)

    const cache = new Map<
      string,
      {
        reachable: boolean
        stateCount: number
        classCount: number
        solveMs: number
      }
    >()
    const results = []
    for (const groupIndex of targetGroupIndexes) {
      const group = groups[groupIndex]
      expect(group).toBeDefined()
      const fixedCapacityFeasible =
        group.eligibleCustomerIds.length >= 8
      const cacheKey =
        `${group.ingredientCost}|${fixedCapacityFeasible ? 1 : 0}`
      let counted = cache.get(cacheKey)
      if (!counted) {
        const startedAt = performance.now()
        const raw = exact311SupportArithmeticReachability(
          groups,
          groupIndex,
        )
        counted = {
          ...raw,
          solveMs: Math.round(performance.now() - startedAt),
        }
        cache.set(cacheKey, counted)
      }
      const maskStartedAt = performance.now()
      const maskCapacity = exact311MaskCapacityReachability(
        groups,
        groupIndex,
      )
      const witness = await find311MaskCapacitySupportWitness(
        groups,
        groupIndex,
      )
      const assignment = witness
        ? maximumAssignmentFlowForGroupCapacities(
            groups,
            domain.serviceableCustomerIds,
            witness.capacities,
          )
        : null
      const cutWitness =
        assignment &&
        assignment.flow < SERVICEABLE_CUSTOMER_COUNT &&
        assignment.violatingGroupIndexes.length > 0
          ? await find311MaskCapacitySupportWitness(
              groups,
              groupIndex,
              assignment.violatingGroupIndexes,
            )
          : null
      const cutAssignment = cutWitness
        ? maximumAssignmentFlowForGroupCapacities(
            groups,
            domain.serviceableCustomerIds,
            cutWitness.capacities,
          )
        : null
      const twoCutProbeGroupIndexes = new Set([1279])
      const twoCutWitness =
        cutAssignment &&
        cutAssignment.flow < SERVICEABLE_CUSTOMER_COUNT &&
        cutAssignment.violatingGroupIndexes.length > 0 &&
        assignment &&
        assignment.violatingGroupIndexes.length > 0 &&
        twoCutProbeGroupIndexes.has(groupIndex)
          ? await find311MaskCapacitySupportWitness(
              groups,
              groupIndex,
              assignment.violatingGroupIndexes,
              cutAssignment.violatingGroupIndexes,
              8,
            )
          : null
      const twoCutAssignment = twoCutWitness
        ? maximumAssignmentFlowForGroupCapacities(
            groups,
            domain.serviceableCustomerIds,
            twoCutWitness.capacities,
          )
        : null
      results.push({
        groupIndex,
        groupCost: group.ingredientCost,
        arithmeticClass: cacheKey,
        eligibleCustomers: group.eligibleCustomerIds.length,
        fixedCapacityFeasible,
        ...counted,
        maskCapacityReachable: maskCapacity.reachable,
        fixedMaskSize: maskCapacity.fixedMaskSize,
        sameMaskGroupCount: maskCapacity.sameMaskGroupCount,
        maskCount: maskCapacity.maskCount,
        maskSolveMs: Math.round(performance.now() - maskStartedAt),
        witnessSupportSize: witness?.support.length ?? 0,
        assignmentFlow: assignment?.flow ?? 0,
        hallViolationGroups:
          assignment?.violatingGroupIndexes.length ?? 0,
        oneCutWitness: cutWitness !== null,
        oneCutAssignmentFlow: cutAssignment?.flow ?? null,
        oneCutHallViolationGroups:
          cutAssignment?.violatingGroupIndexes.length ?? null,
        twoCutWitness: twoCutWitness !== null,
        twoCutAssignmentFlow: twoCutAssignment?.flow ?? null,
        twoCutHallViolationGroups:
          twoCutAssignment?.violatingGroupIndexes.length ?? null,
      })
    }
    console.info(
      '[machine-support-dp-summary]',
      JSON.stringify({
        uniqueArithmeticClasses: cache.size,
        results,
      }),
    )

    expect(
      results.every(
        (result) =>
          !result.maskCapacityReachable ||
          result.assignmentFlow < SERVICEABLE_CUSTOMER_COUNT,
      ),
    ).toBe(true)
  },
  120000,
)



singleSupportMasterProfileIt(
  'probes one exact 3+1+1 support master without extra-one cost-sum splitting',
  async () => {
    const domain = canonicalDomain()
    const groups = pairGroups(domain)
    const rawGroupIndexes =
      machineContinuationEnv.MACHINE_CONTINUATION_SINGLE_MASTER_GROUPS ?? ''
    const targetGroupIndexes = rawGroupIndexes
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value))
    expect(targetGroupIndexes.length).toBeGreaterThan(0)

    const thresholdCounts = [3, 1, 1, 0] as const
    const sharedHallCuts =
      await bootstrap311HallCutsFromDpWitnesses(domain, groups)
    const sharedHallCutKeys = new Set(
      sharedHallCuts.map((cut) => cut.join(',')),
    )
    const initialHallCutCount = sharedHallCuts.length
    const results = []

    for (const groupIndex of targetGroupIndexes) {
      const supportCuts: number[][] = []
      let status = 'round-limit'
      let assignmentFlow: number | null = null
      let exactStatus: string | null = null
      let masterSolveMs = 0
      let exactSolveMs = 0
      let supportSize = 0
      let customerFlowFallbackStatus: string | null = null
      let customerFlowFallbackSolveMs = 0
      let customerFlowFallbackAssignmentFlow: number | null = null
      let customerFlowFallbackExactStatus: string | null = null
      const roundFlows: Array<number | null> = []
      const roundHallCutSizes: number[] = []

      for (let round = 0; round < 16; round += 1) {
        const built = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            supportCuts,
            hallCuts: sharedHallCuts,
            includeCustomerFlow: false,
          },
        )
        const solved = await solveBounded(built.model, 0.5)
        masterSolveMs += solved.solveMs
        if (solved.status !== 'optimal' || !solved.namedSolution) {
          status = solved.status
          break
        }

        const support = groups.flatMap((_group, supportGroupIndex) => {
          const raw = solved.namedSolution!.get(
            `s31su_${supportGroupIndex}`,
          )
          return typeof raw === 'number' &&
            Number.isFinite(raw) &&
            raw > 0.5
            ? [supportGroupIndex]
            : []
        })
        supportSize = support.length
        if (support.length !== 30) {
          throw new Error(
            `Expected 30 support groups for unsplit identity ${groupIndex}, got ${support.length}`,
          )
        }

        const capacities = groups.map((_group, capacityGroupIndex) => {
          const usedRaw = solved.namedSolution!.get(
            `s31su_${capacityGroupIndex}`,
          )
          const used =
            typeof usedRaw === 'number' &&
            Number.isFinite(usedRaw) &&
            usedRaw > 0.5
              ? 1
              : 0
          if (capacityGroupIndex === groupIndex) return used * 8
          const extraRaw = solved.namedSolution!.get(
            `s31se1_${capacityGroupIndex}`,
          )
          const extra =
            typeof extraRaw === 'number' &&
            Number.isFinite(extraRaw) &&
            extraRaw > 0.5
              ? 1
              : 0
          const slackRaw = solved.namedSolution!.get(
            `s31sslack_${capacityGroupIndex}`,
          )
          const slack =
            typeof slackRaw === 'number' &&
            Number.isFinite(slackRaw) &&
            slackRaw > 0.5
              ? 1
              : 0
          return used * 2 + extra * 2 - slack
        })
        const checked = maximumAssignmentFlowForGroupCapacities(
          groups,
          domain.serviceableCustomerIds,
          capacities,
        )
        assignmentFlow = checked.flow
        roundFlows.push(checked.flow)

        if (checked.flow < SERVICEABLE_CUSTOMER_COUNT) {
          if (checked.violatingGroupIndexes.length === 0) {
            status = 'invalid-empty-hall-cut'
            break
          }
          const key = checked.violatingGroupIndexes.join(',')
          if (sharedHallCutKeys.has(key)) {
            status = 'duplicate-hall-cut'
            break
          }
          sharedHallCutKeys.add(key)
          sharedHallCuts.push(checked.violatingGroupIndexes)
          roundHallCutSizes.push(checked.violatingGroupIndexes.length)
          status = 'hall-cut'
          continue
        }

        const exact = buildFinalizing30MaskPartitionStage(
          domain,
          new Set<ProductionStepKind>([
            'juicing',
            'seasoning',
            'blending',
          ]),
          thresholdCounts,
          { max: 76 },
          0,
          new Set(support),
        )
        const exactSolved = await solveBounded(exact.model, 3)
        exactSolveMs += exactSolved.solveMs
        exactStatus = exactSolved.status
        if (exactSolved.status === 'infeasible') {
          supportCuts.push(support)
          status = 'exact-infeasible-support'
          continue
        }
        if (exactSolved.status === 'optimal') {
          status = 'global-witness'
          break
        }
        status = `exact-${exactSolved.status}`
        break
      }

      if (status === 'timelimit') {
        const flowBuilt = build311ExtraCostSumSupportMaster(
          domain,
          groupIndex,
          undefined,
          {
            supportCuts,
            hallCuts: sharedHallCuts,
            includeCustomerFlow: true,
          },
        )
        const flowSolved = await solveBounded(flowBuilt.model, 0.5)
        customerFlowFallbackStatus = flowSolved.status
        customerFlowFallbackSolveMs = flowSolved.solveMs

        if (
          flowSolved.status === 'optimal' &&
          flowSolved.namedSolution
        ) {
          const support = groups.flatMap(
            (_group, supportGroupIndex) => {
              const raw = flowSolved.namedSolution!.get(
                `s31su_${supportGroupIndex}`,
              )
              return typeof raw === 'number' &&
                Number.isFinite(raw) &&
                raw > 0.5
                ? [supportGroupIndex]
                : []
            },
          )
          if (support.length !== 30) {
            throw new Error(
              `Expected 30 support groups from customer-flow fallback for identity ${groupIndex}, got ${support.length}`,
            )
          }
          supportSize = support.length

          const capacities = groups.map(
            (_group, capacityGroupIndex) => {
              const usedRaw = flowSolved.namedSolution!.get(
                `s31su_${capacityGroupIndex}`,
              )
              const used =
                typeof usedRaw === 'number' &&
                Number.isFinite(usedRaw) &&
                usedRaw > 0.5
                  ? 1
                  : 0
              if (capacityGroupIndex === groupIndex) {
                return used * 8
              }
              const extraRaw = flowSolved.namedSolution!.get(
                `s31se1_${capacityGroupIndex}`,
              )
              const extra =
                typeof extraRaw === 'number' &&
                Number.isFinite(extraRaw) &&
                extraRaw > 0.5
                  ? 1
                  : 0
              const slackRaw = flowSolved.namedSolution!.get(
                `s31sslack_${capacityGroupIndex}`,
              )
              const slack =
                typeof slackRaw === 'number' &&
                Number.isFinite(slackRaw) &&
                slackRaw > 0.5
                  ? 1
                  : 0
              return used * 2 + extra * 2 - slack
            },
          )
          const checked = maximumAssignmentFlowForGroupCapacities(
            groups,
            domain.serviceableCustomerIds,
            capacities,
          )
          customerFlowFallbackAssignmentFlow = checked.flow
          if (checked.flow !== SERVICEABLE_CUSTOMER_COUNT) {
            throw new Error(
              `Customer-flow master returned support with assignment flow ${checked.flow}`,
            )
          }

          const exact = buildFinalizing30MaskPartitionStage(
            domain,
            new Set<ProductionStepKind>([
              'juicing',
              'seasoning',
              'blending',
            ]),
            thresholdCounts,
            { max: 76 },
            0,
            new Set(support),
          )
          const exactSolved = await solveBounded(exact.model, 3)
          customerFlowFallbackExactStatus = exactSolved.status
          exactSolveMs += exactSolved.solveMs
          if (exactSolved.status === 'optimal') {
            status = 'global-witness-via-customer-flow'
          } else if (exactSolved.status === 'infeasible') {
            status = 'customer-flow-exact-infeasible-support'
          } else {
            status = `customer-flow-exact-${exactSolved.status}`
          }
        }
      }

      results.push({
        groupIndex,
        groupCost: groups[groupIndex].ingredientCost,
        status,
        supportSize,
        assignmentFlow,
        exactStatus,
        hallCuts: sharedHallCuts.length,
        supportCuts: supportCuts.length,
        roundFlows,
        roundHallCutSizes,
        customerFlowFallbackStatus,
        customerFlowFallbackSolveMs:
          Math.round(customerFlowFallbackSolveMs),
        customerFlowFallbackAssignmentFlow,
        customerFlowFallbackExactStatus,
        masterSolveMs: Math.round(masterSolveMs),
        exactSolveMs: Math.round(exactSolveMs),
      })
    }

    console.info(
      '[machine-single-support-master-summary]',
      JSON.stringify({
        initialHallCuts: initialHallCutCount,
        results,
      }),
    )
  },
  120000,
)
