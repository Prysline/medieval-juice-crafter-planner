import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import {
  profileGroupedMaximumIngredientCostStage,
  profileMaximumIngredientCostParityCostStage,
  profileMaximumIngredientCostGroupedMachineLong,
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

    const parityProfile =
      await profileMaximumIngredientCostParityCostStage(
        model,
        stageProfile.minimumWasteOptimum,
        Math.round(stageProfile.objectiveValue ?? 0),
        20,
      )
    console.info(
      '[maximum-cost-parity-cost-profile]',
      JSON.stringify({
        ...parityProfile,
        buildMs: Math.round(parityProfile.buildMs),
        serializeMs: Math.round(parityProfile.serializeMs),
        parseMs: Math.round(parityProfile.parseMs),
        solveMs: Math.round(parityProfile.solveMs),
      }),
    )
    expect(parityProfile.oddSlackCount).toBe(1)
    expect(parityProfile.status).toBe('optimal')

    const productionCostOptimum =
      parityProfile.productionCostObjective
    expect(productionCostOptimum).not.toBeNull()
    const machineProfile =
      await profileMaximumIngredientCostGroupedMachineLong(
        model,
        stageProfile.minimumWasteOptimum,
        Math.round(stageProfile.objectiveValue ?? 0),
        Math.round(productionCostOptimum ?? 0),
        60,
      )
    console.info(
      '[maximum-cost-machine-long-profile]',
      JSON.stringify({
        ...machineProfile,
        buildMs: Math.round(machineProfile.buildMs),
        serializeMs: Math.round(machineProfile.serializeMs),
        parseMs: Math.round(machineProfile.parseMs),
        solveMs: Math.round(machineProfile.solveMs),
      }),
    )
  },
  180000,
)
