import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  profileOptimizerSolveStages,
  type OptimizerSolveProfile,
} from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  normalizedOptimizationPriorities,
  type OptimizationCriterion,
  type OptimizationRequest,
} from './optimizerModel'

const STAGE_TIME_LIMIT_SECONDS = 10.5

function productionScaleRequest(
  priorities: OptimizationCriterion[],
): OptimizationRequest {
  const currentProgress = 'liquid-blender-unlocked'
  const customerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)

  return {
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
    objective: priorities[0] ?? 'minimum-waste',
    priorities,
    availableJuiceJarCount: 5,
  }
}

function compactProfile(
  label: string,
  modelBuildMs: number,
  modelRecipeCount: number,
  profile: OptimizerSolveProfile,
) {
  return {
    label,
    modelBuildMs: Math.round(modelBuildMs),
    modelRecipeCount,
    priorities: profile.priorities,
    totalMs: Math.round(profile.totalMs),
    stoppedAtObjective: profile.stoppedAtObjective,
    stages: profile.stages.map((stage) => ({
      objective: stage.objective,
      status: stage.status,
      objectiveValue: stage.objectiveValue,
      recipeCount: stage.recipeCount,
      customerCount: stage.customerCount,
      assignmentVariables: stage.assignmentVariableCount,
      variables: stage.variableCount,
      constraints: stage.constraintCount,
      buildMs: Math.round(stage.buildMs),
      serializeMs: Math.round(stage.serializeMs),
      wasmCreateMs: Math.round(stage.wasmCreateMs),
      parseMs: Math.round(stage.parseMs),
      solveMs: Math.round(stage.solveMs),
      minimumCostCertificate: stage.usingMinimumCostCertificate,
      groupedAssignments: stage.aggregateEquivalentAssignments,
    })),
  }
}

it(
  'profiles the player minimum-waste-first optimizer priority patterns',
  async () => {
    const cases: Array<{
      label: string
      priorities: OptimizationCriterion[]
    }> = [
      {
        label: 'minimum-waste',
        priorities: ['minimum-waste'],
      },
      {
        label: 'minimum-waste -> maximum-ingredient-cost',
        priorities: [
          'minimum-waste',
          'maximum-ingredient-cost',
        ],
      },
      {
        label: 'minimum-waste -> maximum-known-gross-profit',
        priorities: [
          'minimum-waste',
          'maximum-known-gross-profit',
        ],
      },
      {
        label: 'minimum-cost -> minimum-waste',
        priorities: ['minimum-cost', 'minimum-waste'],
      },
    ]

    const candidatePool = buildRecipeCandidatePool(
      'liquid-blender-unlocked',
    )
    let baselineMinimumWaste: OptimizerSolveProfile | null = null

    for (const entry of cases) {
      const request = productionScaleRequest(entry.priorities)
      const modelStartedAt = performance.now()
      const model = buildOptimizationModel(request, {
        customers: canonicalCustomers,
        candidatePool,
      })
      const modelBuildMs = performance.now() - modelStartedAt
      const priorities = normalizedOptimizationPriorities(request)
      const profile = await profileOptimizerSolveStages(
        model,
        priorities,
        {
          stageTimeLimitSeconds: STAGE_TIME_LIMIT_SECONDS,
          maxStages: 3,
        },
      )

      if (entry.label === 'minimum-waste') {
        baselineMinimumWaste = profile
      }

      console.info(
        '[optimizer-solve-profile]',
        JSON.stringify(
          compactProfile(
            entry.label,
            modelBuildMs,
            model.recipes.length,
            profile,
          ),
        ),
      )

      expect(profile.stages.length).toBeGreaterThan(0)
    }

    const groupedRequest = productionScaleRequest([
      'minimum-waste',
    ])
    const groupedModelStartedAt = performance.now()
    const groupedModel = buildOptimizationModel(
      groupedRequest,
      {
        customers: canonicalCustomers,
        candidatePool,
      },
    )
    const groupedModelBuildMs =
      performance.now() - groupedModelStartedAt
    const groupedProfile = await profileOptimizerSolveStages(
      groupedModel,
      normalizedOptimizationPriorities(groupedRequest),
      {
        stageTimeLimitSeconds: STAGE_TIME_LIMIT_SECONDS,
        maxStages: 1,
        aggregateEquivalentAssignmentsForProductionUnits: true,
      },
    )

    console.info(
      '[optimizer-solve-profile]',
      JSON.stringify(
        compactProfile(
          'minimum-waste grouped-assignment Stage 1 probe',
          groupedModelBuildMs,
          groupedModel.recipes.length,
          groupedProfile,
        ),
      ),
    )

    expect(groupedProfile.stages).toHaveLength(1)

    const baselineStage =
      baselineMinimumWaste?.stages[0] ?? null
    const groupedStage = groupedProfile.stages[0]
    if (
      baselineStage?.status === 'optimal' &&
      groupedStage.status === 'optimal'
    ) {
      expect(groupedStage.objectiveValue).toBe(
        baselineStage.objectiveValue,
      )
    }
  },
  220000,
)
