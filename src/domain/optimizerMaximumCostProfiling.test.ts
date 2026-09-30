import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import { buildOptimizationModel, type OptimizationRequest } from './optimizerModel'
import { profileMaximumIngredientCostAfterGroupedMinimumWaste } from './optimizerHighsSolver'

it(
  'profiles fresh-main maximum ingredient cost after grouped minimum-waste',
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

    const profile =
      await profileMaximumIngredientCostAfterGroupedMinimumWaste(
        model,
        10.5,
      )

    console.info(
      '[maximum-cost-fresh-profile]',
      JSON.stringify({
        domainBuildMs: Math.round(domainBuildMs),
        ...profile,
        minimumWasteBuildMs: Math.round(profile.minimumWasteBuildMs),
        minimumWasteSolveMs: Math.round(profile.minimumWasteSolveMs),
        maximumCostBuildMs: Math.round(profile.maximumCostBuildMs),
        maximumCostSerializeMs: Math.round(profile.maximumCostSerializeMs),
        maximumCostParseMs: Math.round(profile.maximumCostParseMs),
        maximumCostSolveMs: Math.round(profile.maximumCostSolveMs),
        certificateBuildMs: Math.round(profile.certificateBuildMs),
        certificateSerializeMs: Math.round(profile.certificateSerializeMs),
        certificateParseMs: Math.round(profile.certificateParseMs),
        certificateSolveMs: Math.round(profile.certificateSolveMs),
      }),
    )

    expect(profile.recipeCount).toBeGreaterThan(7000)
    expect(profile.minimumWasteAssignmentVariableCount).toBeLessThan(
      profile.maximumCostAssignmentVariableCount,
    )
    expect(profile.minimumWasteOptimum).toBeGreaterThan(0)
    expect(profile.maximumCostAssignmentVariableCount).toBeGreaterThan(40000)
    expect(profile.certificateAssignmentVariableCount).toBeLessThan(
      profile.maximumCostAssignmentVariableCount,
    )
  },
  90000,
)
