import { Model, sum } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
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
  diagnosisEnv.P4_SEASONING_THRESHOLD_PROOF_DIAGNOSIS === '1'
    ? it
    : it.skip

type CertificateDomain = Parameters<
  typeof solveMachineOperationCertificateForCostFix
>[0]

type IntVariable = ReturnType<Model['intVar']>

interface TimedRun {
  mode: 'optimize' | 'threshold-13'
  elapsedMs: number
  status: string
  objective: number | null
  recipeCount: number
  assignmentGroupCount: number
  operationCount: number
}

function buildSeasoningActiveEdgeModel(
  domain: CertificateDomain,
  fixedMinimumCost: number,
  threshold: number | null,
) {
  const model = new Model()
  const maxJuiceUnitsPerRecipe = Math.max(
    1,
    Math.ceil(domain.serviceableCustomerIds.length / 2),
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

  const yByCustomerGroup = new Map<
    string,
    ReturnType<Model['numVar']>
  >()
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
      sum(...assignmentVars)
        .minus(sum(...capacityTerms))
        .leq(finishedServings),
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
      if (edge.kind !== 'seasoning') continue
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
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([edgeKey, quantityTerms], edgeIndex) => {
      const quantityUpperBound =
        quantityUpperBoundByEdgeKey.get(edgeKey) ?? 0
      const operationCount = model.intVar(0, 1, `op_${edgeIndex}`)
      operationVariables.push(operationCount)
      const quantityExpression = sum(...quantityTerms)
      model.addConstraint(
        quantityExpression
          .minus(
            operationCount.times(Math.max(1, quantityUpperBound)),
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

  model.addConstraint(
    sum(
      ...domain.recipes.flatMap((recipe) => {
        const x = xByRecipeId.get(recipe.candidate.id)
        return x ? [x.times(recipe.juiceUnitIngredientCost)] : []
      }),
    ).eq(fixedMinimumCost),
    'fix_cost_0',
  )

  const operationSum = sum(...operationVariables)
  if (threshold === null) {
    model.minimize(operationSum)
  } else {
    model.addConstraint(
      operationSum.leq(threshold),
      'seasoning_active_edge_threshold',
    )
    model.minimize(operationVariables[0].times(0))
  }

  return {
    model,
    assignmentGroupCount: groups.length,
    operationCount: operationVariables.length,
  }
}

async function runTimed(
  domain: CertificateDomain,
  fixedMinimumCost: number,
  threshold: number | null,
): Promise<TimedRun> {
  const built = buildSeasoningActiveEdgeModel(
    domain,
    fixedMinimumCost,
    threshold,
  )
  const startedAt = performance.now()
  const solution = await built.model.solve()
  const elapsedMs = performance.now() - startedAt

  return {
    mode: threshold === null ? 'optimize' : 'threshold-13',
    elapsedMs,
    status: solution.status,
    objective:
      solution.objective === undefined || !Number.isFinite(solution.objective)
        ? null
        : solution.objective,
    recipeCount: domain.recipes.length,
    assignmentGroupCount: built.assignmentGroupCount,
    operationCount: built.operationCount,
  }
}

describe('diagnosis-only seasoning active-edge threshold proof', () => {
  diagnosisIt('compares optimization with infeasibility proof at activeEdges <= 13 on one runner', async () => {
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
    const continuationDomain = stage1!.continuationDomain
    const fixedMinimumCost = 604

    const baselineA = await runTimed(
      continuationDomain,
      fixedMinimumCost,
      null,
    )
    const thresholdA = await runTimed(
      continuationDomain,
      fixedMinimumCost,
      13,
    )
    const thresholdB = await runTimed(
      continuationDomain,
      fixedMinimumCost,
      13,
    )
    const baselineB = await runTimed(
      continuationDomain,
      fixedMinimumCost,
      null,
    )

    expect(baselineA.status).toBe('optimal')
    expect(baselineB.status).toBe('optimal')
    expect(Math.round(baselineA.objective!)).toBe(14)
    expect(Math.round(baselineB.objective!)).toBe(14)
    expect(thresholdA.status).toBe('infeasible')
    expect(thresholdB.status).toBe('infeasible')
    expect(baselineA.recipeCount).toBe(3076)
    expect(baselineA.assignmentGroupCount).toBe(301)
    expect(baselineA.operationCount).toBe(75)

    const baselineMeanMs =
      (baselineA.elapsedMs + baselineB.elapsedMs) / 2
    const thresholdMeanMs =
      (thresholdA.elapsedMs + thresholdB.elapsedMs) / 2

    console.info(
      `[P4 seasoning threshold-proof A/B] ${JSON.stringify({
        baselineA,
        thresholdA,
        thresholdB,
        baselineB,
        baselineMeanMs,
        thresholdMeanMs,
        thresholdToBaselineRatio: thresholdMeanMs / baselineMeanMs,
      })}`,
    )
  }, 180000)
})
