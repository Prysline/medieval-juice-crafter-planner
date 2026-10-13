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
  diagnosisEnv.P4_SEASONING_RELAXED_X_DIAGNOSIS === '1'
    ? it
    : it.skip

type CertificateDomain = Parameters<
  typeof solveMachineOperationCertificateForCostFix
>[0]

type RecipeUnitMode = 'integer' | 'continuous'
type ProductionVariable = ReturnType<Model['numVar']>
type LinearTerm = ReturnType<ProductionVariable['times']>

interface TimedRun {
  mode: RecipeUnitMode
  elapsedMs: number
  objective: number
  recipeCount: number
  assignmentGroupCount: number
  operationCount: number
}

function buildSeasoningActiveEdgeModel(
  domain: CertificateDomain,
  fixedMinimumCost: number,
  mode: RecipeUnitMode,
) {
  const model = new Model()
  const maxJuiceUnitsPerRecipe = Math.max(
    1,
    Math.ceil(domain.serviceableCustomerIds.length / 2),
  )
  const xByRecipeId = new Map<string, ProductionVariable>()
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
    const x: ProductionVariable =
      mode === 'continuous'
        ? model.numVar(0, recipeUpperBound, `x_${recipeIndex}`)
        : model.intVar(0, recipeUpperBound, `x_${recipeIndex}`)
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

  const quantityTermsByEdgeKey = new Map<string, LinearTerm[]>()
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

  const operationVariables: ReturnType<Model['intVar']>[] = []
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
  model.minimize(sum(...operationVariables))

  return {
    model,
    assignmentGroupCount: groups.length,
    operationCount: operationVariables.length,
  }
}

async function runTimed(
  domain: CertificateDomain,
  fixedMinimumCost: number,
  mode: RecipeUnitMode,
): Promise<TimedRun> {
  const built = buildSeasoningActiveEdgeModel(
    domain,
    fixedMinimumCost,
    mode,
  )
  const startedAt = performance.now()
  const solution = await built.model.solve()
  const elapsedMs = performance.now() - startedAt

  expect(solution.status).toBe('optimal')
  expect(solution.objective).toBeDefined()

  return {
    mode,
    elapsedMs,
    objective: Math.round(solution.objective!),
    recipeCount: domain.recipes.length,
    assignmentGroupCount: built.assignmentGroupCount,
    operationCount: built.operationCount,
  }
}

describe('diagnosis-only seasoning active-edge recipe-unit relaxation', () => {
  diagnosisIt('compares integer recipe units with a continuous-x lower-bound relaxation on one runner', async () => {
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
      'integer',
    )
    const variantA = await runTimed(
      continuationDomain,
      fixedMinimumCost,
      'continuous',
    )
    const variantB = await runTimed(
      continuationDomain,
      fixedMinimumCost,
      'continuous',
    )
    const baselineB = await runTimed(
      continuationDomain,
      fixedMinimumCost,
      'integer',
    )

    expect(baselineA.objective).toBe(14)
    expect(baselineB.objective).toBe(14)
    expect(variantA.objective).toBeLessThanOrEqual(baselineA.objective)
    expect(variantB.objective).toBe(variantA.objective)
    expect(variantA.recipeCount).toBe(3076)
    expect(variantA.assignmentGroupCount).toBe(301)
    expect(variantA.operationCount).toBe(75)

    const baselineMeanMs =
      (baselineA.elapsedMs + baselineB.elapsedMs) / 2
    const variantMeanMs =
      (variantA.elapsedMs + variantB.elapsedMs) / 2

    console.info(
      `[P4 seasoning relaxed-x A/B] ${JSON.stringify({
        baselineA,
        variantA,
        variantB,
        baselineB,
        relaxationClosesExactly:
          variantA.objective === baselineA.objective &&
          variantB.objective === baselineB.objective,
        baselineMeanMs,
        variantMeanMs,
        variantToBaselineRatio: variantMeanMs / baselineMeanMs,
      })}`,
    )
  }, 180000)
})
