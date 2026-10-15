import { Model, sum } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import {
  machineOperationBreakdownForSelection,
  type RecipeUnitSelection,
} from './optimizerCertificates'
import * as highsSolverModule from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import type { ProductionStepKind } from './productionPlan'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

declare const process: {
  env: Record<string, string | undefined>
  memoryUsage(): { rss: number }
}

const enabled = process.env.OPTIMIZER_PHASE_H_CANONICAL69_WITNESS === '1'
const EXPECTED_PREFIX = {
  productionUnits: 34,
  assignedIngredientCost: 3751,
  productionCost: 1897,
} as const
const PARTITION = {
  throughSeasoning: 37,
  blending: 36,
  finalizing: 29,
} as const
const TARGET_MACHINE = 102

type IntVariable = ReturnType<Model['intVar']>
type BoolVariable = ReturnType<Model['boolVar']>
type HighsSolution = Awaited<ReturnType<Model['solve']>>
type ObjectiveFix = {
  objective:
    | 'productionUnits'
    | 'negativeAssignedIngredientCost'
    | 'cost'
  value: number
}
interface HarnessBuilt {
  model: Model
  xByRecipeId: Map<string, IntVariable>
  yByCustomerRecipe: Map<string, BoolVariable>
  operationByEdgeKey: Map<string, IntVariable>
}
type BuildHighsStage = (
  domain: BatchOptimizationModel,
  objective: 'machineOperations',
  fixes: ObjectiveFix[],
  options?: Record<string, unknown>,
) => HarnessBuilt

function request69(): OptimizationRequest {
  const currentProgress = 'liquid-blender-unlocked'
  const customerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)
    .slice(0, 69)
  return {
    customerIds,
    currentProgress,
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 9999,
      'tranquil-fountain': 9999,
      'ibex-statue': 9999,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'allow-unambiguous-computed',
    objective: 'minimum-waste',
    priorities: ['minimum-waste', 'maximum-ingredient-cost'],
    availableJuiceJarCount: 5,
  }
}

function buildStage(): BuildHighsStage {
  const result = (
    highsSolverModule as unknown as { buildHighsStage?: BuildHighsStage }
  ).buildHighsStage
  if (!result) throw new Error('Phase H diagnosis seam unavailable')
  return result
}

function prefixFixes(): ObjectiveFix[] {
  return [
    { objective: 'productionUnits', value: EXPECTED_PREFIX.productionUnits },
    {
      objective: 'negativeAssignedIngredientCost',
      value: -EXPECTED_PREFIX.assignedIngredientCost,
    },
    { objective: 'cost', value: EXPECTED_PREFIX.productionCost },
  ]
}

function add102Equalities(domain: BatchOptimizationModel, built: HarnessBuilt) {
  const kindByEdge = new Map<string, ProductionStepKind>()
  for (const recipe of domain.recipes) {
    for (const edge of recipe.productionPath.edges) {
      kindByEdge.set(edge.key, edge.kind)
    }
  }
  const throughSeasoning: IntVariable[] = []
  const blending: IntVariable[] = []
  const finalizing: IntVariable[] = []
  for (const [edgeKey, variable] of built.operationByEdgeKey) {
    const kind = kindByEdge.get(edgeKey)
    if (kind === 'juicing' || kind === 'seasoning') throughSeasoning.push(variable)
    else if (kind === 'blending') blending.push(variable)
    else if (kind === 'finalizing') finalizing.push(variable)
  }
  built.model.addConstraint(
    sum(...throughSeasoning).eq(PARTITION.throughSeasoning),
    'phase_h_witness_through_seasoning',
  )
  built.model.addConstraint(
    sum(...blending).eq(PARTITION.blending),
    'phase_h_witness_blending',
  )
  built.model.addConstraint(
    sum(...finalizing).eq(PARTITION.finalizing),
    'phase_h_witness_finalizing',
  )
  built.model.addConstraint(
    sum(...built.operationByEdgeKey.values()).eq(TARGET_MACHINE),
    'phase_h_witness_total',
  )
}

function value(
  solution: HighsSolution,
  variable: IntVariable | BoolVariable,
  label: string,
) {
  const result = solution.getValue(variable)
  if (result === undefined || !Number.isFinite(result)) {
    throw new Error(`Missing Phase H value for ${label}`)
  }
  return result
}

function witnessFrom(
  domain: BatchOptimizationModel,
  built: HarnessBuilt,
  solution: HighsSolution,
): RecipeUnitSelection[] {
  return domain.recipes.flatMap((recipe) => {
    const variable = built.xByRecipeId.get(recipe.candidate.id)
    if (!variable) return []
    const units = Math.round(value(solution, variable, recipe.candidate.id))
    return units > 0 ? [{ recipeId: recipe.candidate.id, units }] : []
  })
}

async function fullVerify(
  domain: BatchOptimizationModel,
  witness: RecipeUnitSelection[],
) {
  const built = buildStage()(
    domain,
    'machineOperations',
    prefixFixes(),
    {
      fixedRecipeUnits: new Map(
        witness.map((selection) => [selection.recipeId, selection.units]),
      ),
      tightenRecipeBoundsFromMinimumCostFix: true,
      tightenOperationBoundsFromRecipeBounds: true,
    },
  )
  const startedAt = performance.now()
  const solution = await built.model.solve()
  const solveMs = performance.now() - startedAt
  if (solution.status !== 'optimal') {
    return { status: solution.status, solveMs, verified: false as const }
  }
  const objective = Math.round(solution.objective ?? Number.NaN)
  if (objective !== TARGET_MACHINE) {
    return { status: solution.status, solveMs, verified: false as const }
  }

  const recipeById = new Map(
    domain.recipes.map((recipe) => [recipe.candidate.id, recipe]),
  )
  const unitsByRecipeId = new Map(
    witness.map((selection) => [selection.recipeId, selection.units]),
  )
  const assignments = new Map<string, string>()
  for (const [key, variable] of built.yByCustomerRecipe) {
    if (value(solution, variable, key) <= 0.5) continue
    const split = key.indexOf('\u001f')
    const customerId = key.slice(0, split)
    const recipeId = key.slice(split + 1)
    if (assignments.has(customerId)) {
      throw new Error(`Duplicate Phase H assignment for ${customerId}`)
    }
    assignments.set(customerId, recipeId)
  }
  expect(assignments.size).toBe(domain.serviceableCustomerIds.length)

  let assignedIngredientCost = 0
  const assignedByRecipe = new Map<string, number>()
  for (const customerId of domain.serviceableCustomerIds) {
    const recipeId = assignments.get(customerId)
    if (!recipeId) throw new Error(`Missing assignment for ${customerId}`)
    const recipe = recipeById.get(recipeId)
    if (!recipe) throw new Error(`Unknown assignment recipe ${recipeId}`)
    expect(recipe.eligibleCustomerIds).toContain(customerId)
    assignedIngredientCost += recipe.juiceUnitIngredientCost
    assignedByRecipe.set(recipeId, (assignedByRecipe.get(recipeId) ?? 0) + 1)
  }
  for (const [recipeId, assigned] of assignedByRecipe) {
    const recipe = recipeById.get(recipeId)
    if (!recipe) throw new Error(`Unknown capacity recipe ${recipeId}`)
    const capacity =
      (recipe.initialFinishedServings ?? 0) +
      2 * (unitsByRecipeId.get(recipeId) ?? 0)
    expect(assigned).toBeLessThanOrEqual(capacity)
  }

  const productionUnits = witness.reduce((sum, entry) => sum + entry.units, 0)
  const productionCost = witness.reduce((sum, entry) => {
    const recipe = recipeById.get(entry.recipeId)
    if (!recipe) throw new Error(`Unknown witness recipe ${entry.recipeId}`)
    return sum + entry.units * recipe.juiceUnitIngredientCost
  }, 0)
  const machine = machineOperationBreakdownForSelection(domain, witness)

  expect(productionUnits).toBe(EXPECTED_PREFIX.productionUnits)
  expect(productionCost).toBe(EXPECTED_PREFIX.productionCost)
  expect(assignedIngredientCost).toBe(EXPECTED_PREFIX.assignedIngredientCost)
  expect(machine.total).toBe(TARGET_MACHINE)
  expect(machine.juicing + machine.seasoning).toBe(PARTITION.throughSeasoning)
  expect(machine.blending).toBe(PARTITION.blending)
  expect(machine.finalizing).toBe(PARTITION.finalizing)

  return {
    status: solution.status,
    solveMs,
    verified: true as const,
    assignments: assignments.size,
    witnessRecipeIdentities: witness.length,
    assignmentRecipeKinds: new Set(assignments.values()).size,
    machine,
  }
}

describe.skipIf(!enabled)('Phase H canonical-69 witness-first prototype', () => {
  it(
    'uses assignment relaxation only to propose x and accepts only full original-domain verification',
    async () => {
      const totalStartedAt = performance.now()
      const request = request69()
      const candidateStartedAt = performance.now()
      const candidatePool = buildRecipeCandidatePool(request.currentProgress)
      const candidatePoolMs = performance.now() - candidateStartedAt
      const domainStartedAt = performance.now()
      const domain = buildOptimizationModel(request, {
        customers: canonicalCustomers,
        candidatePool,
      })
      const domainBuildMs = performance.now() - domainStartedAt

      const relaxed = buildStage()(
        domain,
        'machineOperations',
        prefixFixes(),
        {
          aggregateEquivalentMaximumCostAssignments: true,
          relaxAssignmentVariables: true,
          tightenRecipeBoundsFromMinimumCostFix: true,
          tightenOperationBoundsFromRecipeBounds: true,
        },
      )
      add102Equalities(domain, relaxed)
      const relaxedStartedAt = performance.now()
      const relaxedSolution = await relaxed.model.solve()
      const relaxedSolveMs = performance.now() - relaxedStartedAt

      console.info(
        '[phase-h-canonical69-witness-relaxation]',
        JSON.stringify({
          status: relaxedSolution.status,
          objective:
            typeof relaxedSolution.objective === 'number'
              ? relaxedSolution.objective
              : null,
          recipes: domain.recipes.length,
          recipeIntegerVars: relaxed.xByRecipeId.size,
          relaxedAssignmentVars: relaxed.yByCustomerRecipe.size,
          operationIntegerVars: relaxed.operationByEdgeKey.size,
          candidatePoolMs,
          domainBuildMs,
          relaxedSolveMs,
          rssMb: process.memoryUsage().rss / 1024 / 1024,
        }),
      )

      if (relaxedSolution.status === 'infeasible') {
        throw new Error(
          'Assignment-relaxed superset is exactly infeasible at total machine 102; no original-domain 102 witness exists',
        )
      }
      expect(
        relaxedSolution.status,
        'Limit/unknown on witness relaxation is performance evidence only',
      ).toBe('optimal')
      if (relaxedSolution.status !== 'optimal') return

      const witness = witnessFrom(domain, relaxed, relaxedSolution)
      const verification = await fullVerify(domain, witness)
      console.info(
        '[phase-h-canonical69-witness-verification]',
        JSON.stringify({
          ...verification,
          totalMs: performance.now() - totalStartedAt,
          rssMb: process.memoryUsage().rss / 1024 / 1024,
        }),
      )
      expect(
        verification.verified,
        'Relaxed assignment candidate is not an exact result until full original-domain fixed-x verification succeeds',
      ).toBe(true)
    },
    1_800_000,
  )
})
