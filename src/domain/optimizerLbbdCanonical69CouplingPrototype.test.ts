import { Model, sum } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import {
  finalizingEdgesAreRecipeIdentityUnique,
  minimumRecipeKindsFromFinalizingBound,
  type RecipeUnitSelection,
} from './optimizerCertificates'
import * as highsSolverModule from './optimizerHighsSolver'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'
import type { ProductionStepKind } from './productionPlan'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

declare const process: {
  env: Record<string, string | undefined>
  memoryUsage(): {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
    arrayBuffers: number
  }
}

const enabled = process.env.OPTIMIZER_PHASE_H_CANONICAL69_PROTOTYPE === '1'
const REQUESTED_CUSTOMER_COUNT = 69
const EXPECTED_PREFIX = {
  productionUnits: 34,
  assignedIngredientCost: 3751,
  productionCost: 1897,
} as const
const KNOWN_PARTITION_LOWER_BOUNDS = {
  throughSeasoning: 37,
  blending: 36,
  finalizing: 29,
} as const
const KNOWN_MACHINE_LOWER_BOUND =
  KNOWN_PARTITION_LOWER_BOUNDS.throughSeasoning +
  KNOWN_PARTITION_LOWER_BOUNDS.blending +
  KNOWN_PARTITION_LOWER_BOUNDS.finalizing

type IntVariable = ReturnType<Model['intVar']>
type BoolVariable = ReturnType<Model['boolVar']>
type HighsSolution = Awaited<ReturnType<Model['solve']>>

type ObjectiveFix = {
  objective:
    | 'productionUnits'
    | 'negativeAssignedIngredientCost'
    | 'cost'
    | 'machineOperations'
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
  objective: 'machineOperations' | 'kinds',
  fixes: ObjectiveFix[],
  options?: Record<string, unknown>,
) => HarnessBuilt

type IdentityAssignment = {
  customerId: string
  recipeId: string
}

function currentWorldRequest(): OptimizationRequest {
  const currentProgress = 'liquid-blender-unlocked'
  const availableCustomerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)
  const customerIds = availableCustomerIds.slice(0, REQUESTED_CUSTOMER_COUNT)

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

function compactMemory() {
  const usage = process.memoryUsage()
  return {
    rssMb: usage.rss / 1024 / 1024,
    heapUsedMb: usage.heapUsed / 1024 / 1024,
    heapTotalMb: usage.heapTotal / 1024 / 1024,
    externalMb: usage.external / 1024 / 1024,
    arrayBuffersMb: usage.arrayBuffers / 1024 / 1024,
  }
}

function phaseHBuildHighsStage(): BuildHighsStage {
  const candidate = (
    highsSolverModule as unknown as {
      buildHighsStage?: BuildHighsStage
    }
  ).buildHighsStage
  if (!candidate) {
    throw new Error(
      'Phase H diagnosis seam is unavailable; focused workflow must export buildHighsStage at runtime',
    )
  }
  return candidate
}

function prefixEquivalenceKey(recipe: EligibleOptimizationRecipe) {
  return JSON.stringify({
    eligibleCustomerIds: [...recipe.eligibleCustomerIds].sort(),
    juiceUnitIngredientCost: recipe.juiceUnitIngredientCost,
    initialFinishedServings: recipe.initialFinishedServings ?? 0,
    maxProductionUnits: recipe.maxProductionUnits ?? null,
  })
}

function structuralDimensions(domain: BatchOptimizationModel) {
  const serviceable = new Set(domain.serviceableCustomerIds)
  const uniqueProductionEdges = new Set<string>()
  let assignmentEdges = 0
  let productionEdges = 0

  for (const recipe of domain.recipes) {
    assignmentEdges += recipe.eligibleCustomerIds.filter((customerId) =>
      serviceable.has(customerId),
    ).length
    productionEdges += recipe.productionPath.edges.length
    for (const edge of recipe.productionPath.edges) {
      uniqueProductionEdges.add(edge.key)
    }
  }

  return {
    requestedCustomers: REQUESTED_CUSTOMER_COUNT,
    serviceableCustomers: domain.serviceableCustomerIds.length,
    unresolvedCustomers: domain.unresolvedCustomerIds.length,
    recipes: domain.recipes.length,
    assignmentEdges,
    productionEdges,
    uniqueProductionEdges: uniqueProductionEdges.size,
    exactEquivalenceGroups: new Set(
      domain.recipes.map(prefixEquivalenceKey),
    ).size,
  }
}

function exactPrefixFixes(): ObjectiveFix[] {
  return [
    {
      objective: 'productionUnits',
      value: EXPECTED_PREFIX.productionUnits,
    },
    {
      objective: 'negativeAssignedIngredientCost',
      value: -EXPECTED_PREFIX.assignedIngredientCost,
    },
    {
      objective: 'cost',
      value: EXPECTED_PREFIX.productionCost,
    },
  ]
}

function operationKindByEdgeKey(domain: BatchOptimizationModel) {
  const result = new Map<string, ProductionStepKind>()
  for (const recipe of domain.recipes) {
    for (const edge of recipe.productionPath.edges) {
      const previous = result.get(edge.key)
      if (previous && previous !== edge.kind) {
        throw new Error(
          `Phase H production edge ${edge.key} changed kind from ${previous} to ${edge.kind}`,
        )
      }
      result.set(edge.key, edge.kind)
    }
  }
  return result
}

function addKnownPartitionEqualities(
  domain: BatchOptimizationModel,
  built: HarnessBuilt,
) {
  const kindByEdgeKey = operationKindByEdgeKey(domain)
  const throughSeasoning: IntVariable[] = []
  const blending: IntVariable[] = []
  const finalizing: IntVariable[] = []

  for (const [edgeKey, variable] of built.operationByEdgeKey) {
    const kind = kindByEdgeKey.get(edgeKey)
    if (kind === 'juicing' || kind === 'seasoning') {
      throughSeasoning.push(variable)
    } else if (kind === 'blending') {
      blending.push(variable)
    } else if (kind === 'finalizing') {
      finalizing.push(variable)
    } else {
      throw new Error(`Phase H operation edge ${edgeKey} has no known kind`)
    }
  }

  if (
    throughSeasoning.length === 0 ||
    blending.length === 0 ||
    finalizing.length === 0
  ) {
    throw new Error('Phase H coupling model is missing a machine partition')
  }

  built.model.addConstraint(
    sum(...throughSeasoning).eq(
      KNOWN_PARTITION_LOWER_BOUNDS.throughSeasoning,
    ),
    'phase_h_through_seasoning_exact',
  )
  built.model.addConstraint(
    sum(...blending).eq(KNOWN_PARTITION_LOWER_BOUNDS.blending),
    'phase_h_blending_exact',
  )
  built.model.addConstraint(
    sum(...finalizing).eq(KNOWN_PARTITION_LOWER_BOUNDS.finalizing),
    'phase_h_finalizing_exact',
  )
  built.model.addConstraint(
    sum(...built.operationByEdgeKey.values()).eq(KNOWN_MACHINE_LOWER_BOUND),
    'phase_h_machine_total_exact',
  )

  return {
    throughSeasoningEdges: throughSeasoning.length,
    blendingEdges: blending.length,
    finalizingEdges: finalizing.length,
  }
}

function requiredSolutionValue(
  solution: HighsSolution,
  variable: IntVariable | BoolVariable,
  label: string,
) {
  const value = solution.getValue(variable)
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`Phase H missing solver value for ${label}`)
  }
  return value
}

function selectedRecipeUnits(
  domain: BatchOptimizationModel,
  built: HarnessBuilt,
  solution: HighsSolution,
): RecipeUnitSelection[] {
  return domain.recipes.flatMap((recipe) => {
    const variable = built.xByRecipeId.get(recipe.candidate.id)
    if (!variable) return []
    const units = Math.round(
      requiredSolutionValue(
        solution,
        variable,
        `recipe ${recipe.candidate.id}`,
      ),
    )
    return units > 0
      ? [{ recipeId: recipe.candidate.id, units }]
      : []
  })
}

function identityAssignments(
  domain: BatchOptimizationModel,
  built: HarnessBuilt,
  solution: HighsSolution,
): IdentityAssignment[] {
  const selectedByCustomerId = new Map<string, IdentityAssignment[]>()

  for (const [key, variable] of built.yByCustomerRecipe) {
    if (
      requiredSolutionValue(solution, variable, `assignment ${key}`) <= 0.5
    ) {
      continue
    }
    const separator = key.indexOf('\u001f')
    if (separator < 0) {
      throw new Error(`Phase H malformed assignment key ${key}`)
    }
    const assignment = {
      customerId: key.slice(0, separator),
      recipeId: key.slice(separator + 1),
    }
    const current = selectedByCustomerId.get(assignment.customerId) ?? []
    current.push(assignment)
    selectedByCustomerId.set(assignment.customerId, current)
  }

  return domain.serviceableCustomerIds.map((customerId) => {
    const selected = selectedByCustomerId.get(customerId) ?? []
    if (selected.length !== 1) {
      throw new Error(
        `Phase H original-domain assignment count for ${customerId}: ${selected.length}`,
      )
    }
    return selected[0]
  })
}

function independentWitnessMetrics(
  domain: BatchOptimizationModel,
  assignments: readonly IdentityAssignment[],
  witness: readonly RecipeUnitSelection[],
) {
  const recipeById = new Map(
    domain.recipes.map((recipe) => [recipe.candidate.id, recipe]),
  )
  const unitsByRecipeId = new Map(
    witness.map((selection) => [selection.recipeId, selection.units]),
  )
  const edgeQuantity = new Map<string, number>()
  const edgeKind = new Map<string, ProductionStepKind>()

  let productionUnits = 0
  let productionCost = 0
  for (const selection of witness) {
    const recipe = recipeById.get(selection.recipeId)
    if (!recipe) throw new Error(`Unknown Phase H witness recipe ${selection.recipeId}`)
    productionUnits += selection.units
    productionCost += selection.units * recipe.juiceUnitIngredientCost
    for (const edge of recipe.productionPath.edges) {
      edgeQuantity.set(
        edge.key,
        (edgeQuantity.get(edge.key) ?? 0) + selection.units,
      )
      edgeKind.set(edge.key, edge.kind)
    }
  }

  let assignedIngredientCost = 0
  const assignedCountByRecipeId = new Map<string, number>()
  for (const assignment of assignments) {
    const recipe = recipeById.get(assignment.recipeId)
    if (!recipe) {
      throw new Error(`Unknown Phase H assignment recipe ${assignment.recipeId}`)
    }
    if (!recipe.eligibleCustomerIds.includes(assignment.customerId)) {
      throw new Error(
        `Ineligible Phase H assignment ${assignment.customerId}/${assignment.recipeId}`,
      )
    }
    assignedIngredientCost += recipe.juiceUnitIngredientCost
    assignedCountByRecipeId.set(
      assignment.recipeId,
      (assignedCountByRecipeId.get(assignment.recipeId) ?? 0) + 1,
    )
  }

  for (const [recipeId, assignedCount] of assignedCountByRecipeId) {
    const recipe = recipeById.get(recipeId)
    if (!recipe) throw new Error(`Unknown Phase H capacity recipe ${recipeId}`)
    const capacity =
      (recipe.initialFinishedServings ?? 0) +
      (unitsByRecipeId.get(recipeId) ?? 0) * 2
    if (assignedCount > capacity) {
      throw new Error(`Phase H assignment exceeds capacity for ${recipeId}`)
    }
  }

  const machine = {
    juicing: 0,
    seasoning: 0,
    blending: 0,
    finalizing: 0,
    total: 0,
  }
  for (const [edgeKey, quantity] of edgeQuantity) {
    const operations = Math.ceil(quantity / PROCESSING_STACK_CAPACITY)
    const kind = edgeKind.get(edgeKey)
    if (!kind) throw new Error(`Missing Phase H edge kind ${edgeKey}`)
    machine[kind] += operations
    machine.total += operations
  }

  return {
    productionUnits,
    assignedIngredientCost,
    productionCost,
    machine,
    recipeKinds: new Set(assignments.map((assignment) => assignment.recipeId)).size,
    positiveRecipeKinds: new Set(
      witness.filter((selection) => selection.units > 0).map((selection) => selection.recipeId),
    ).size,
  }
}

function closureDisposition(status: string) {
  if (status === 'optimal') return 'witness-ready' as const
  if (status === 'infeasible') return 'exact-infeasible-at-102' as const
  return 'fallback-required' as const
}

async function verifyFixedWitness(
  buildHighsStage: BuildHighsStage,
  domain: BatchOptimizationModel,
  witness: readonly RecipeUnitSelection[],
) {
  const fixedRecipeUnits = new Map(
    witness.map((selection) => [selection.recipeId, selection.units]),
  )
  const built = buildHighsStage(
    domain,
    'machineOperations',
    exactPrefixFixes(),
    {
      fixedRecipeUnits,
      tightenRecipeBoundsFromMinimumCostFix: true,
      tightenOperationBoundsFromRecipeBounds: true,
    },
  )
  const startedAt = performance.now()
  const solution = await built.model.solve()
  const solveMs = performance.now() - startedAt
  if (solution.status !== 'optimal') {
    throw new Error(
      `Phase H full original-domain fixed-x verification status: ${solution.status}`,
    )
  }
  const objective = Math.round(solution.objective ?? Number.NaN)
  if (objective !== KNOWN_MACHINE_LOWER_BOUND) {
    throw new Error(
      `Phase H fixed-x machine objective ${objective} != ${KNOWN_MACHINE_LOWER_BOUND}`,
    )
  }
  const assignments = identityAssignments(domain, built, solution)
  const metrics = independentWitnessMetrics(domain, assignments, witness)
  return { assignments, metrics, solveMs }
}

describe.skipIf(!enabled)('Phase H canonical-69 exact coupling prototype', () => {
  it(
    'tests exact coupling at the proven 102 lower bound and verifies a full identity witness',
    async () => {
      const totalStartedAt = performance.now()
      const memoryBefore = compactMemory()
      const request = currentWorldRequest()

      const candidateStartedAt = performance.now()
      const candidatePool = buildRecipeCandidatePool(request.currentProgress)
      const candidatePoolMs = performance.now() - candidateStartedAt
      const memoryAfterCandidate = compactMemory()

      const domainStartedAt = performance.now()
      const domain = buildOptimizationModel(request, {
        customers: canonicalCustomers,
        candidatePool,
      })
      const domainBuildMs = performance.now() - domainStartedAt
      const memoryAfterDomain = compactMemory()
      const dimensions = structuralDimensions(domain)
      const globalServingSlack =
        EXPECTED_PREFIX.productionUnits * 2 - domain.serviceableCustomerIds.length

      expect(domain.recipes.length).toBeGreaterThan(0)
      expect(domain.serviceableCustomerIds.length).toBeGreaterThan(0)
      expect(globalServingSlack).toBeGreaterThanOrEqual(0)
      expect(globalServingSlack).toBeLessThanOrEqual(1)
      expect(
        domain.recipes.every(
          (recipe) => (recipe.initialFinishedServings ?? 0) === 0,
        ),
      ).toBe(true)

      console.info(
        '[phase-h-canonical69-domain]',
        JSON.stringify({
          dimensions,
          globalServingSlack,
          candidatePoolMs,
          domainBuildMs,
          memory: {
            before: memoryBefore,
            afterCandidate: memoryAfterCandidate,
            afterDomain: memoryAfterDomain,
          },
        }),
      )

      const buildHighsStage = phaseHBuildHighsStage()
      const couplingBuildStartedAt = performance.now()
      const coupling = buildHighsStage(
        domain,
        'machineOperations',
        exactPrefixFixes(),
        {
          aggregateEquivalentMaximumCostAssignments: true,
          tightenRecipeBoundsFromMinimumCostFix: true,
          tightenOperationBoundsFromRecipeBounds: true,
        },
      )
      const partitionEdges = addKnownPartitionEqualities(domain, coupling)
      const couplingBuildMs = performance.now() - couplingBuildStartedAt

      console.info(
        '[phase-h-canonical69-coupling-model]',
        JSON.stringify({
          recipeIntegerVars: coupling.xByRecipeId.size,
          exactGroupedAssignmentVars: coupling.yByCustomerRecipe.size,
          operationIntegerVars: coupling.operationByEdgeKey.size,
          partitionEdges,
          couplingBuildMs,
          memory: compactMemory(),
        }),
      )

      const couplingSolveStartedAt = performance.now()
      const couplingSolution = await coupling.model.solve()
      const couplingSolveMs = performance.now() - couplingSolveStartedAt
      const disposition = closureDisposition(couplingSolution.status)

      console.info(
        '[phase-h-canonical69-coupling-result]',
        JSON.stringify({
          status: couplingSolution.status,
          disposition,
          objective:
            typeof couplingSolution.objective === 'number'
              ? couplingSolution.objective
              : null,
          couplingSolveMs,
          memory: compactMemory(),
        }),
      )

      expect(
        disposition,
        disposition === 'exact-infeasible-at-102'
          ? 'Exact coupling model proves no total-machine-102 witness; next proof unit must start above 102'
          : 'Coupling work did not produce an exact witness; limit/unknown remains fallback-required',
      ).toBe('witness-ready')
      if (disposition !== 'witness-ready') return

      expect(Math.round(couplingSolution.objective ?? Number.NaN)).toBe(
        KNOWN_MACHINE_LOWER_BOUND,
      )
      let finalWitness = selectedRecipeUnits(
        domain,
        coupling,
        couplingSolution,
      )
      let verification = await verifyFixedWitness(
        buildHighsStage,
        domain,
        finalWitness,
      )

      expect(verification.assignments).toHaveLength(
        domain.serviceableCustomerIds.length,
      )
      expect(
        new Set(verification.assignments.map((entry) => entry.customerId)),
      ).toEqual(new Set(domain.serviceableCustomerIds))
      expect(verification.metrics.productionUnits).toBe(
        EXPECTED_PREFIX.productionUnits,
      )
      expect(verification.metrics.assignedIngredientCost).toBe(
        EXPECTED_PREFIX.assignedIngredientCost,
      )
      expect(verification.metrics.productionCost).toBe(
        EXPECTED_PREFIX.productionCost,
      )
      expect(verification.metrics.machine).toEqual({
        juicing: expect.any(Number),
        seasoning: expect.any(Number),
        blending: KNOWN_PARTITION_LOWER_BOUNDS.blending,
        finalizing: KNOWN_PARTITION_LOWER_BOUNDS.finalizing,
        total: KNOWN_MACHINE_LOWER_BOUND,
      })
      expect(
        verification.metrics.machine.juicing +
          verification.metrics.machine.seasoning,
      ).toBe(KNOWN_PARTITION_LOWER_BOUNDS.throughSeasoning)

      expect(finalizingEdgesAreRecipeIdentityUnique(domain)).toBe(true)
      const recipeKindsLowerBound = minimumRecipeKindsFromFinalizingBound(
        EXPECTED_PREFIX.productionUnits,
        KNOWN_PARTITION_LOWER_BOUNDS.finalizing,
      )
      let recipeKindsOptimum: number
      let recipeKindsSolveMs = 0
      let recipeKindsVerificationMs = verification.solveMs

      if (
        verification.metrics.positiveRecipeKinds === recipeKindsLowerBound &&
        verification.metrics.recipeKinds === recipeKindsLowerBound
      ) {
        recipeKindsOptimum = recipeKindsLowerBound
      } else {
        const kindsBuilt = buildHighsStage(
          domain,
          'kinds',
          [
            ...exactPrefixFixes(),
            {
              objective: 'machineOperations',
              value: KNOWN_MACHINE_LOWER_BOUND,
            },
          ],
          {
            tightenRecipeBoundsFromMinimumCostFix: true,
            tightenOperationBoundsFromRecipeBounds: true,
          },
        )
        addKnownPartitionEqualities(domain, kindsBuilt)
        const kindsSolveStartedAt = performance.now()
        const kindsSolution = await kindsBuilt.model.solve()
        recipeKindsSolveMs = performance.now() - kindsSolveStartedAt
        expect(kindsSolution.status).toBe('optimal')
        if (kindsSolution.status !== 'optimal') return

        recipeKindsOptimum = Math.round(
          kindsSolution.objective ?? Number.NaN,
        )
        finalWitness = selectedRecipeUnits(domain, kindsBuilt, kindsSolution)
        verification = await verifyFixedWitness(
          buildHighsStage,
          domain,
          finalWitness,
        )
        recipeKindsVerificationMs += verification.solveMs
      }

      expect(recipeKindsOptimum).toBeGreaterThanOrEqual(
        recipeKindsLowerBound,
      )
      expect(verification.metrics.recipeKinds).toBe(recipeKindsOptimum)
      expect(verification.metrics.positiveRecipeKinds).toBe(
        recipeKindsOptimum,
      )
      expect(verification.metrics.machine.total).toBe(
        KNOWN_MACHINE_LOWER_BOUND,
      )

      const totalMs = performance.now() - totalStartedAt
      console.info(
        '[phase-h-canonical69-exact-closure]',
        JSON.stringify({
          dimensions,
          prefix: EXPECTED_PREFIX,
          machineLowerBound: KNOWN_MACHINE_LOWER_BOUND,
          machineUpperBound: verification.metrics.machine.total,
          machinePartitionLowerBounds: KNOWN_PARTITION_LOWER_BOUNDS,
          independentMachineBreakdown: verification.metrics.machine,
          recipeKindsLowerBound,
          recipeKindsOptimum,
          recipeKindsUpperBound: verification.metrics.recipeKinds,
          witnessRecipeIdentities: finalWitness.length,
          verifiedAssignmentCount: verification.assignments.length,
          couplingSubproblems: 1,
          fullDomainVerificationSolves:
            recipeKindsSolveMs > 0 ? 2 : 1,
          generatedColumns: 0,
          generatedCuts: 0,
          candidatePoolMs,
          domainBuildMs,
          couplingBuildMs,
          couplingSolveMs,
          recipeKindsSolveMs,
          fixedXVerificationMs: recipeKindsVerificationMs,
          totalMs,
          memory: compactMemory(),
        }),
      )
    },
    1_800_000,
  )

  it('keeps non-exact coupling statuses out of infeasibility claims', () => {
    expect(closureDisposition('time_limit')).toBe('fallback-required')
    expect(closureDisposition('unknown')).toBe('fallback-required')
    expect(closureDisposition('optimal')).toBe('witness-ready')
    expect(closureDisposition('infeasible')).toBe('exact-infeasible-at-102')
  })
})