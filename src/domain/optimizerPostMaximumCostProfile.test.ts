import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  profilePostMaximumCostGenericContinuation,
} from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'

it(
  'profiles fresh-main generic production-cost continuation',
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
      await profilePostMaximumCostGenericContinuation(model, 10.5)

    console.info(
      '[post-maximum-cost-baseline]',
      JSON.stringify({
        domainBuildMs: Math.round(domainBuildMs),
        ...profile,
        productionCostBuildMs:
          Math.round(profile.productionCostBuildMs),
        productionCostSerializeMs:
          Math.round(profile.productionCostSerializeMs),
        productionCostParseMs:
          Math.round(profile.productionCostParseMs),
        productionCostSolveMs:
          Math.round(profile.productionCostSolveMs),
      }),
    )

    expect(profile.recipeCount).toBeGreaterThan(7000)
    expect(profile.customerCount).toBeGreaterThan(60)
    expect(profile.minimumWasteOptimum).toBe(35)
    expect(profile.maximumIngredientCostOptimum).toBe(3853)
    expect(profile.maximumCostAssignmentVariableCount).toBeLessThan(
      profile.productionCostAssignmentVariableCount,
    )
    expect(profile.productionCostRecipeVariableCount).toBeGreaterThan(
      7000,
    )
  },
  120000,
)
