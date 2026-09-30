import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import {
  profileGroupedMaximumIngredientCostStage,
  profileMaximumIngredientCostContinuationStages,
} from './optimizerHighsSolver'
import { buildOptimizationModel, type OptimizationRequest } from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

it(
  'profiles grouped maximum ingredient cost Stage 2 on fresh canonical scale',
  async () => {
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

    const candidatePool = buildRecipeCandidatePool(currentProgress)
    const domainBuildStartedAt = performance.now()
    const model = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool,
    })
    const domainBuildMs = performance.now() - domainBuildStartedAt

    const stageProfile =
      await profileGroupedMaximumIngredientCostStage(model, 20)

    console.info(
      '[maximum-cost-grouped-stage-profile]',
      JSON.stringify({
        domainBuildMs: Math.round(domainBuildMs),
        ...stageProfile,
        buildMs: Math.round(stageProfile.buildMs),
        serializeMs: Math.round(stageProfile.serializeMs),
        parseMs: Math.round(stageProfile.parseMs),
        solveMs: Math.round(stageProfile.solveMs),
      }),
    )

    expect(stageProfile.recipeCount).toBeGreaterThan(7000)
    expect(stageProfile.customerCount).toBe(
      model.serviceableCustomerIds.length,
    )
    expect(stageProfile.minimumWasteOptimum).toBeGreaterThan(0)
    expect(stageProfile.assignmentVariableCount).toBeLessThan(49756)
    expect(stageProfile.groupedProductionVariableCount).toBeLessThan(
      stageProfile.recipeCount,
    )
    expect(stageProfile.status).toBe('optimal')

    const continuation =
      await profileMaximumIngredientCostContinuationStages(
        model,
        10.5,
      )
    console.info(
      '[maximum-cost-continuation-profile]',
      JSON.stringify({
        productionUnits: continuation.productionUnits,
        maximumCostOptimum: continuation.maximumCostOptimum,
        assignedIngredientCost: continuation.assignedIngredientCost,
        slackServings: continuation.slackServings,
        minimumRecipeCost: continuation.minimumRecipeCost,
        costLowerBound: continuation.costLowerBound,
        witnessProductionCost: continuation.witnessProductionCost,
        costCertificateCloses: continuation.costCertificateCloses,
        costGroupedLong: {
          ...continuation.costGroupedLong,
          buildMs: Math.round(continuation.costGroupedLong.buildMs),
          serializeMs: Math.round(continuation.costGroupedLong.serializeMs),
          parseMs: Math.round(continuation.costGroupedLong.parseMs),
          solveMs: Math.round(continuation.costGroupedLong.solveMs),
        },
        machineGeneric: continuation.machineGeneric
          ? {
              ...continuation.machineGeneric,
              buildMs: Math.round(continuation.machineGeneric.buildMs),
              serializeMs: Math.round(continuation.machineGeneric.serializeMs),
              parseMs: Math.round(continuation.machineGeneric.parseMs),
              solveMs: Math.round(continuation.machineGeneric.solveMs),
            }
          : null,
        machineGrouped: continuation.machineGrouped
          ? {
              ...continuation.machineGrouped,
              buildMs: Math.round(continuation.machineGrouped.buildMs),
              serializeMs: Math.round(continuation.machineGrouped.serializeMs),
              parseMs: Math.round(continuation.machineGrouped.parseMs),
              solveMs: Math.round(continuation.machineGrouped.solveMs),
            }
          : null,
      }),
    )
    expect(continuation.slackServings).toBe(1)
  },
  120000,
)
