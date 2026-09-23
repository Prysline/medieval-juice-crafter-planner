import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import {
  buildOptimizationModel,
  normalizedOptimizationPriorities,
  type OptimizationRequest,
} from './optimizerModel'
import {
  buildRecipeCandidatePool,
  recipeCandidatesInCurrentSearchScope,
} from './recipeCandidatePool'

it(
  'profiles the production-scale Blender computed optimizer workload',
  async () => {
    const request: OptimizationRequest = {
      customerIds: canonicalCustomers.map((customer) => customer.id),
      currentProgress: 'juice-blender-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
      },
      formalCustomerIds: canonicalCustomers.map(
        (customer) => customer.id,
      ),
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-cost',
      priorities: [
        'minimum-cost',
        'minimum-machine-operations',
        'minimum-jar-switches',
      ],
      availableJuiceJarCount: 2,
    }

    const candidateGenerationStartedAt = performance.now()
    const candidatePool = buildRecipeCandidatePool(
      request.currentProgress,
    )
    const candidateGenerationMs =
      performance.now() - candidateGenerationStartedAt
    const generatedCurrentCandidates =
      recipeCandidatesInCurrentSearchScope(candidatePool)

    const modelBuildStartedAt = performance.now()
    const model = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool,
    })
    const modelBuildMs = performance.now() - modelBuildStartedAt

    const assignmentEligibilityCount = model.recipes.reduce(
      (total, recipe) => total + recipe.eligibleCustomerIds.length,
      0,
    )
    const productionEdgeCount = new Set(
      model.recipes.flatMap((recipe) =>
        recipe.productionPath.edges.map((edge) => edge.key),
      ),
    ).size

    const solverImportStartedAt = performance.now()
    const { profileHighsOptimization } = await import(
      './optimizerHighsSolver'
    )
    const solverModuleImportMs =
      performance.now() - solverImportStartedAt

    const highs = await profileHighsOptimization(
      model,
      normalizedOptimizationPriorities(request),
    )
    const firstStageSolveMs = highs.stages[0]?.solveMs ?? 0
    const repeatedStageSolveMs = highs.stages
      .slice(1)
      .reduce((total, stage) => total + stage.solveMs, 0)

    const report = {
      progress: request.currentProgress,
      candidatePolicy: request.candidatePolicy,
      canonicalCustomerCount: canonicalCustomers.length,
      serviceableCustomerCount: model.serviceableCustomerIds.length,
      unresolvedCustomerCount: model.unresolvedCustomerIds.length,
      candidatePoolEntries: candidatePool.entries.length,
      generatedCurrentCandidates: generatedCurrentCandidates.length,
      optimizerEligibleRecipes: model.recipes.length,
      customerRecipeAssignmentEligibility: assignmentEligibilityCount,
      yVariables: assignmentEligibilityCount,
      xVariables: model.recipes.length,
      zVariables: model.recipes.length,
      productionEdgeVariables: productionEdgeCount,
      finalHighsVariables: highs.finalVariableCount,
      finalHighsConstraints: highs.finalConstraintCount,
      candidateGenerationMs,
      optimizerModelBuildMs: modelBuildMs,
      solverModuleImportMs,
      firstStageSolveMs,
      repeatedStageSolveMs,
      highsModelBuildMs: highs.totalBuildMs,
      highsSolveMs: highs.totalSolveMs,
      highsTotalMs: highs.totalMs,
      stages: highs.stages,
    }

    console.info(
      `[Debug-D1 optimizer profile] ${JSON.stringify(report)}`,
    )

    expect(candidatePool.entries.length).toBeGreaterThan(0)
    expect(generatedCurrentCandidates.length).toBeGreaterThan(0)
    expect(model.serviceableCustomerIds.length).toBeGreaterThan(0)
    expect(model.recipes.length).toBeGreaterThan(0)
    expect(assignmentEligibilityCount).toBeGreaterThan(0)
    expect(productionEdgeCount).toBeGreaterThan(0)
    expect(highs.stages.length).toBeGreaterThanOrEqual(
      request.priorities?.length ?? 1,
    )
    expect(highs.finalVariableCount).toBeGreaterThan(0)
    expect(highs.finalConstraintCount).toBeGreaterThan(0)
  },
  // Diagnostic-only headroom so the profiler can finish even on the
  // pathological workload. Existing optimizer smoke tests keep the normal
  // timeout; Debug-D2 must reduce the measured cost rather than rely on this.
  60_000,
)
