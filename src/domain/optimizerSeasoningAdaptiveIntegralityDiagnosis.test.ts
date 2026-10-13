import { Model, sum } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { prepareMinimumCostStageCertificate } from './optimizerCertificates'
import { solveMachineOperationCertificateForCostFix } from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  type EligibleOptimizationRecipe,
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
  diagnosisEnv.P4_SEASONING_ADAPTIVE_INTEGRALITY_DIAGNOSIS === '1'
    ? it
    : it.skip

type CertificateDomain = Parameters<
  typeof solveMachineOperationCertificateForCostFix
>[0]

type ProductionVariable = ReturnType<Model['numVar']>
type IntVariable = ReturnType<Model['intVar']>
type LinearTerm = ReturnType<ProductionVariable['times']>

interface IntegralityGroup {
  key: string
  recipes: typeof import('./optimizerModel').buildOptimizationModel extends (
    ...args: never[]
  ) => infer R
    ? R extends { recipes: infer Recipes }
      ? Recipes
      : never
    : never
}

interface AdaptiveStep {
  iteration: number
  elapsedMs: number
  objective: number
  integerGroupCount: number
  fractionalUnselectedGroupCount: number
  newlySelectedGroupCount: number
}

interface AdaptiveRun {
  elapsedMs: number
  objective: number
  selectedGroupCount: number
  steps: AdaptiveStep[]
}

function serviceKey(recipe: EligibleOptimizationRecipe): string {
  return [...recipe.eligibleCustomerIds].sort().join('\u001e')
}

function serviceCostKey(recipe: EligibleOptimizationRecipe): string {
  return `${serviceKey(recipe)}\u001d${recipe.juiceUnitIngredientCost}`
}

function buildSeasoningModel(
  domain: CertificateDomain,
  fixedMinimumCost: number,
  integerRecipeUnits: boolean,
  integerGroupKeys: ReadonlySet<string>,
) {
  const model = new Model()
  const maxJuiceUnitsPerRecipe = Math.max(
    1,
    Math.ceil(domain.serviceableCustomerIds.length / 2),
  )

  const assignmentGroups = new Map<
    string,
    {
      recipes: typeof domain.recipes
      eligibleCustomerIds: string[]
    }
  >()
  const integralityGroups = new Map<
    string,
    { key: string; recipes: typeof domain.recipes }
  >()

  for (const recipe of domain.recipes) {
    const assignmentKey = serviceKey(recipe)
    const assignmentGroup = assignmentGroups.get(assignmentKey)
    if (assignmentGroup) assignmentGroup.recipes.push(recipe)
    else {
      assignmentGroups.set(assignmentKey, {
        recipes: [recipe],
        eligibleCustomerIds: [...recipe.eligibleCustomerIds].sort(),
      })
    }

    const integerKey = serviceCostKey(recipe)
    const integerGroup = integralityGroups.get(integerKey)
    if (integerGroup) integerGroup.recipes.push(recipe)
    else {
      integralityGroups.set(integerKey, {
        key: integerKey,
        recipes: [recipe],
      })
    }
  }

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
    const x: ProductionVariable = integerRecipeUnits
      ? model.intVar(0, recipeUpperBound, `x_${recipeIndex}`)
      : model.numVar(0, recipeUpperBound, `x_${recipeIndex}`)
    xByRecipeId.set(recipe.candidate.id, x)
    recipeUpperBoundById.set(recipe.candidate.id, recipeUpperBound)
  }

  let integerGroupVariableCount = 0
  for (const [groupIndex, group] of [
    ...integralityGroups.values(),
  ].entries()) {
    if (!integerGroupKeys.has(group.key)) continue
    const recipeVariables = group.recipes.flatMap((recipe) => {
      const x = xByRecipeId.get(recipe.candidate.id)
      return x ? [x] : []
    })
    const upperBound = group.recipes.reduce(
      (total, recipe) =>
        total + (recipeUpperBoundById.get(recipe.candidate.id) ?? 0),
      0,
    )
    const groupUnits = model.intVar(
      0,
      Math.max(0, upperBound),
      `x_group_${groupIndex}`,
    )
    integerGroupVariableCount += 1
    model.addConstraint(
      sum(...recipeVariables).minus(groupUnits).eq(0),
      `group_units_${groupIndex}`,
    )
  }

  const yByCustomerGroup = new Map<
    string,
    ReturnType<Model['numVar']>
  >()
  const assignmentGroupEntries = [...assignmentGroups.entries()]

  domain.serviceableCustomerIds.forEach((customerId, customerIndex) => {
    const assignmentVars: ReturnType<Model['numVar']>[] = []
    assignmentGroupEntries.forEach(([groupKey, group], groupIndex) => {
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

  assignmentGroupEntries.forEach(([groupKey, group], groupIndex) => {
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
  model.minimize(sum(...operationVariables))

  return {
    model,
    xByRecipeId,
    integralityGroups,
    integerGroupVariableCount,
    operationCount: operationVariables.length,
  }
}

function fractionalUnselectedGroups(
  built: ReturnType<typeof buildSeasoningModel>,
  solution: Awaited<ReturnType<Model['solve']>>,
  selected: ReadonlySet<string>,
): string[] {
  const result: string[] = []
  for (const [key, group] of built.integralityGroups) {
    if (selected.has(key)) continue
    const total = group.recipes.reduce((sumValue, recipe) => {
      const x = built.xByRecipeId.get(recipe.candidate.id)
      if (!x) return sumValue
      return sumValue + solution.getValue(x)
    }, 0)
    if (!Number.isFinite(total)) {
      throw new Error(`Non-finite group total for ${key}`)
    }
    if (Math.abs(total - Math.round(total)) > 1e-6) {
      result.push(key)
    }
  }
  return result
}

async function runIntegerBaseline(
  domain: CertificateDomain,
  fixedMinimumCost: number,
) {
  const built = buildSeasoningModel(
    domain,
    fixedMinimumCost,
    true,
    new Set(),
  )
  const startedAt = performance.now()
  const solution = await built.model.solve()
  const elapsedMs = performance.now() - startedAt
  expect(solution.status).toBe('optimal')
  expect(solution.objective).toBeDefined()
  return {
    elapsedMs,
    objective: Math.round(solution.objective!),
  }
}

async function runAdaptive(
  domain: CertificateDomain,
  fixedMinimumCost: number,
): Promise<AdaptiveRun> {
  const selected = new Set<string>()
  const steps: AdaptiveStep[] = []
  const startedAt = performance.now()
  let objective = -1

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const built = buildSeasoningModel(
      domain,
      fixedMinimumCost,
      false,
      selected,
    )
    const solveStartedAt = performance.now()
    const solution = await built.model.solve()
    const elapsedMs = performance.now() - solveStartedAt
    expect(solution.status).toBe('optimal')
    expect(solution.objective).toBeDefined()
    objective = Math.round(solution.objective!)

    const fractional = fractionalUnselectedGroups(
      built,
      solution,
      selected,
    )
    const before = selected.size
    if (objective < 14) {
      for (const key of fractional) selected.add(key)
    }
    const newlySelectedGroupCount = selected.size - before

    steps.push({
      iteration,
      elapsedMs,
      objective,
      integerGroupCount: built.integerGroupVariableCount,
      fractionalUnselectedGroupCount: fractional.length,
      newlySelectedGroupCount,
    })

    if (objective >= 14) break
    if (newlySelectedGroupCount === 0) break
  }

  return {
    elapsedMs: performance.now() - startedAt,
    objective,
    selectedGroupCount: selected.size,
    steps,
  }
}

describe('diagnosis-only adaptive seasoning integrality', () => {
  diagnosisIt('adds integer service-cost totals only for fractional groups until the lower bound closes or stalls', async () => {
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

    const baselineA = await runIntegerBaseline(
      continuationDomain,
      fixedMinimumCost,
    )
    const adaptiveA = await runAdaptive(
      continuationDomain,
      fixedMinimumCost,
    )
    const adaptiveB = await runAdaptive(
      continuationDomain,
      fixedMinimumCost,
    )
    const baselineB = await runIntegerBaseline(
      continuationDomain,
      fixedMinimumCost,
    )

    expect(baselineA.objective).toBe(14)
    expect(baselineB.objective).toBe(14)
    expect(adaptiveA.objective).toBeLessThanOrEqual(14)
    expect(adaptiveB.objective).toBe(adaptiveA.objective)

    const baselineMeanMs =
      (baselineA.elapsedMs + baselineB.elapsedMs) / 2
    const adaptiveMeanMs =
      (adaptiveA.elapsedMs + adaptiveB.elapsedMs) / 2

    console.info(
      `[P4 seasoning adaptive-integrality A/B] ${JSON.stringify({
        baselineA,
        adaptiveA,
        adaptiveB,
        baselineB,
        adaptiveClosesExactly:
          adaptiveA.objective === 14 && adaptiveB.objective === 14,
        baselineMeanMs,
        adaptiveMeanMs,
        adaptiveToBaselineRatio: adaptiveMeanMs / baselineMeanMs,
      })}`,
    )
  }, 300000)
})
