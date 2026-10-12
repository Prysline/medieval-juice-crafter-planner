import { Model, sum } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { prepareMinimumCostStageCertificate } from './optimizerCertificates'
import { solveMachineOperationCertificateForCostFix } from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

const diagnosisEnv =
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env ?? {}

const diagnosisIt =
  diagnosisEnv.P4_MACHINE_CERTIFICATE_DIAGNOSIS === '1'
    ? it
    : it.skip

type CertificateDomain = Parameters<
  typeof solveMachineOperationCertificateForCostFix
>[0]

type IntVariable = ReturnType<Model['intVar']>

type OperationLinkMode = 'current' | 'exact-ceiling'

interface TimedPartitionRun {
  elapsedMs: number
  objective: number
  recipeCount: number
  assignmentGroupCount: number
  operationCount: number
  operationUsageConstraintCount: number
}

function buildThroughSeasoningDiagnosisModel(
  domain: CertificateDomain,
  fixedMinimumCost: number,
  operationLinkMode: OperationLinkMode,
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
  const recipeUpperBoundById = new Map<string, number>()

  for (const [recipeIndex, recipe] of domain.recipes.entries()) {
    const customerCapacityUpperBound = Math.max(
      1,
      Math.ceil(recipe.eligibleCustomerIds.length / 2),
    )
    const costUpperBound =
      recipe.juiceUnitIngredientCost > 0
        ? Math.floor(fixedMinimumCost / recipe.juiceUnitIngredientCost)
        : maxJuiceUnitsPerRecipe
    const computedRecipeUpperBound = Math.max(
      0,
      Math.min(
        maxJuiceUnitsPerRecipe,
        customerCapacityUpperBound,
        costUpperBound,
      ),
    )
    const recipeUpperBound = Math.min(
      computedRecipeUpperBound,
      recipe.maxProductionUnits === undefined
        ? computedRecipeUpperBound
        : Math.max(0, Math.floor(recipe.maxProductionUnits)),
    )
    const x = model.intVar(0, recipeUpperBound, `x_${recipeIndex}`)
    xByRecipeId.set(recipe.candidate.id, x)
    recipeUpperBoundById.set(recipe.candidate.id, recipeUpperBound)
  }

  const assignmentGroups = new Map<
    string,
    {
      recipes: typeof domain.recipes
      eligibleCustomerIds: string[]
    }
  >()
  for (const recipe of domain.recipes) {
    const eligibleCustomerIds = [...recipe.eligibleCustomerIds].sort()
    const key = eligibleCustomerIds.join('\u001e')
    const existing = assignmentGroups.get(key)
    if (existing) existing.recipes.push(recipe)
    else {
      assignmentGroups.set(key, {
        recipes: [recipe],
        eligibleCustomerIds,
      })
    }
  }

  const yByCustomerGroup = new Map<string, ReturnType<Model['numVar']>>()
  const groups = [...assignmentGroups.entries()]

  domain.serviceableCustomerIds.forEach((customerId, customerIndex) => {
    const assignmentVars: ReturnType<Model['numVar']>[] = []
    groups.forEach(([groupKey, group], groupIndex) => {
      if (!group.eligibleCustomerIds.includes(customerId)) return
      const y = model.numVar(0, 1, `y_${customerIndex}_${groupIndex}`)
      yByCustomerGroup.set(`${customerId}\u001f${groupKey}`, y)
      assignmentVars.push(y)
    })
    model.addConstraint(
      sum(...assignmentVars).eq(1),
      `customer_${customerIndex}`,
    )
  })

  groups.forEach(([groupKey, group], groupIndex) => {
    const assignmentVars = group.eligibleCustomerIds.flatMap((customerId) => {
      const y = yByCustomerGroup.get(`${customerId}\u001f${groupKey}`)
      return y ? [y] : []
    })
    const capacityTerms = group.recipes.flatMap((recipe) => {
      const x = xByRecipeId.get(recipe.candidate.id)
      return x ? [x.times(2)] : []
    })
    const finishedServings = group.recipes.reduce(
      (total, recipe) => total + (recipe.initialFinishedServings ?? 0),
      0,
    )
    model.addConstraint(
      sum(...assignmentVars).minus(sum(...capacityTerms)).leq(finishedServings),
      `capacity_${groupIndex}`,
    )
  })

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
      if (edge.kind !== 'juicing' && edge.kind !== 'seasoning') continue
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

  const operationVariables: IntVariable[] = []
  let operationUsageConstraintCount = 0
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, quantityTerms], edgeIndex) => {
      const operationUpperBound = Math.min(
        maxTotalJuiceUnits,
        Math.ceil(
          (quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0) /
            PROCESSING_STACK_CAPACITY,
        ),
      )
      const operationCount = model.intVar(
        0,
        operationUpperBound,
        `op_${edgeIndex}`,
      )
      operationVariables.push(operationCount)
      const quantityExpression = sum(...quantityTerms)

      model.addConstraint(
        quantityExpression
          .minus(operationCount.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `operation_capacity_${edgeIndex}`,
      )
      model.addConstraint(
        operationLinkMode === 'exact-ceiling'
          ? operationCount
              .times(PROCESSING_STACK_CAPACITY)
              .minus(quantityExpression)
              .leq(PROCESSING_STACK_CAPACITY - 1)
          : operationCount.minus(quantityExpression).leq(0),
        `operation_usage_${edgeIndex}`,
      )
      operationUsageConstraintCount += 1
    },
  )

  model.addConstraint(
    sum(
      ...domain.recipes.flatMap((recipe) => {
        const x = xByRecipeId.get(recipe.candidate.id)
        return x ? [x.times(recipe.juiceUnitIngredientCost)] : []
      }),
    ).eq(fixedMinimumCost),
    'fix_cost_0',
  )
  model.minimize(sum(...operationVariables))

  return {
    model,
    assignmentGroupCount: groups.length,
    operationCount: operationVariables.length,
    operationUsageConstraintCount,
  }
}

async function runTimedPartition(
  domain: CertificateDomain,
  operationLinkMode: OperationLinkMode,
): Promise<TimedPartitionRun> {
  const built = buildThroughSeasoningDiagnosisModel(domain, 604, operationLinkMode)
  const startedAt = performance.now()
  const solution = await built.model.solve()
  const elapsedMs = performance.now() - startedAt
  expect(solution.status).toBe('optimal')
  expect(solution.objective).toBeDefined()

  return {
    elapsedMs,
    objective: Math.round(solution.objective!),
    recipeCount: domain.recipes.length,
    assignmentGroupCount: built.assignmentGroupCount,
    operationCount: built.operationCount,
    operationUsageConstraintCount: built.operationUsageConstraintCount,
  }
}

describe('diagnosis-only P4 machine certificate solve timing', () => {
  diagnosisIt('compares current vs exact-ceiling throughSeasoning operation links on one runner', async () => {
    const customerIds = canonicalCustomers.map((customer) => customer.id)
    const request: OptimizationRequest = {
      customerIds,
      currentProgress: 'juice-blender-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
        'ibex-statue': 0,
      },
      formalCustomerIds: customerIds,
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-cost',
      priorities: ['minimum-cost', 'minimum-machine-operations'],
      availableJuiceJarCount: 2,
    }
    const domain = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool: buildRecipeCandidatePool(request.currentProgress),
    })
    const stage1 = prepareMinimumCostStageCertificate(domain)

    expect(stage1).not.toBeNull()

    const baseline = await runTimedPartition(stage1!.continuationDomain, 'current')
    const variant = await runTimedPartition(
      stage1!.continuationDomain,
      'exact-ceiling',
    )

    expect(baseline.objective).toBe(23)
    expect(variant.objective).toBe(23)
    expect(variant.recipeCount).toBe(baseline.recipeCount)
    expect(variant.assignmentGroupCount).toBe(baseline.assignmentGroupCount)
    expect(variant.operationCount).toBe(baseline.operationCount)
    expect(variant.operationUsageConstraintCount).toBe(
      baseline.operationUsageConstraintCount,
    )

    console.info(
      `[P4 throughSeasoning exact-ceiling A/B] ${JSON.stringify({
        baseline,
        variant,
        deltaMs: variant.elapsedMs - baseline.elapsedMs,
        ratio: variant.elapsedMs / baseline.elapsedMs,
      })}`,
    )
  }, 120000)
})
