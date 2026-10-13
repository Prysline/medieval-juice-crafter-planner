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
  diagnosisEnv.P4_SEASONING_GROUP_INTEGRALITY_DIAGNOSIS === '1'
    ? it
    : it.skip

type CertificateDomain = Parameters<
  typeof solveMachineOperationCertificateForCostFix
>[0]

type FormulationMode = 'integer-recipe' | 'integer-service-cost-group'
type ProductionVariable = ReturnType<Model['numVar']>
type IntVariable = ReturnType<Model['intVar']>
type LinearTerm = ReturnType<ProductionVariable['times']>

interface TimedRun {
  mode: FormulationMode
  elapsedMs: number
  objective: number
  recipeCount: number
  assignmentGroupCount: number
  integralityGroupCount: number
  integerRecipeVariableCount: number
  integerGroupVariableCount: number
  operationCount: number
}

function serviceKey(recipe: EligibleOptimizationRecipe): string {
  return [...recipe.eligibleCustomerIds].sort().join('\u001e')
}

function serviceCostKey(recipe: EligibleOptimizationRecipe): string {
  return `${serviceKey(recipe)}\u001d${recipe.juiceUnitIngredientCost}`
}

function buildSeasoningActiveEdgeModel(
  domain: CertificateDomain,
  fixedMinimumCost: number,
  mode: FormulationMode,
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
    { recipes: typeof domain.recipes }
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
    else integralityGroups.set(integerKey, { recipes: [recipe] })
  }

  const xByRecipeId = new Map<string, ProductionVariable>()
  const recipeUpperBoundById = new Map<string, number>()
  let integerRecipeVariableCount = 0

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
      mode === 'integer-recipe'
        ? model.intVar(0, recipeUpperBound, `x_${recipeIndex}`)
        : model.numVar(0, recipeUpperBound, `x_${recipeIndex}`)
    if (mode === 'integer-recipe') integerRecipeVariableCount += 1
    xByRecipeId.set(recipe.candidate.id, x)
    recipeUpperBoundById.set(recipe.candidate.id, recipeUpperBound)
  }

  let integerGroupVariableCount = 0
  if (mode === 'integer-service-cost-group') {
    ;[...integralityGroups.values()].forEach((group, groupIndex) => {
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
    })
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
    assignmentGroupCount: assignmentGroups.size,
    integralityGroupCount: integralityGroups.size,
    integerRecipeVariableCount,
    integerGroupVariableCount,
    operationCount: operationVariables.length,
  }
}

async function runTimed(
  domain: CertificateDomain,
  fixedMinimumCost: number,
  mode: FormulationMode,
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
    integralityGroupCount: built.integralityGroupCount,
    integerRecipeVariableCount: built.integerRecipeVariableCount,
    integerGroupVariableCount: built.integerGroupVariableCount,
    operationCount: built.operationCount,
  }
}

describe('diagnosis-only seasoning selective recipe-unit integrality', () => {
  diagnosisIt('compares integer recipe units with integer service-cost group totals on one runner', async () => {
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
      'integer-recipe',
    )
    const variantA = await runTimed(
      continuationDomain,
      fixedMinimumCost,
      'integer-service-cost-group',
    )
    const variantB = await runTimed(
      continuationDomain,
      fixedMinimumCost,
      'integer-service-cost-group',
    )
    const baselineB = await runTimed(
      continuationDomain,
      fixedMinimumCost,
      'integer-recipe',
    )

    expect(baselineA.objective).toBe(14)
    expect(baselineB.objective).toBe(14)
    expect(variantA.objective).toBeLessThanOrEqual(baselineA.objective)
    expect(variantB.objective).toBe(variantA.objective)
    expect(variantA.recipeCount).toBe(3076)
    expect(variantA.assignmentGroupCount).toBe(301)
    expect(variantA.integralityGroupCount).toBe(301)
    expect(variantA.integerRecipeVariableCount).toBe(0)
    expect(variantA.integerGroupVariableCount).toBe(301)
    expect(variantA.operationCount).toBe(75)

    const baselineMeanMs =
      (baselineA.elapsedMs + baselineB.elapsedMs) / 2
    const variantMeanMs =
      (variantA.elapsedMs + variantB.elapsedMs) / 2

    console.info(
      `[P4 seasoning group-integrality A/B] ${JSON.stringify({
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
