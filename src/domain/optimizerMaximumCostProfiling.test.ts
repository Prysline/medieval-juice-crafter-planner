import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import { profileMaximumIngredientCostStage } from './optimizerHighsSolver'

it(
  'profiles maximum ingredient cost after the proven minimum-waste fix',
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
      priorities: [
        'minimum-waste',
        'maximum-ingredient-cost',
      ],
      availableJuiceJarCount: 5,
    }

    const candidatePool = buildRecipeCandidatePool(currentProgress)
    const modelStartedAt = performance.now()
    const model = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool,
    })
    const domainBuildMs = performance.now() - modelStartedAt

    const stage = await profileMaximumIngredientCostStage(
      model,
      34,
      10.5,
    )

    console.info(
      '[maximum-cost-expression-profile]',
      JSON.stringify({
        domainBuildMs: Math.round(domainBuildMs),
        ...stage,
        buildMs: Math.round(stage.buildMs),
        serializeMs: Math.round(stage.serializeMs),
        parseMs: Math.round(stage.parseMs),
        solveMs: Math.round(stage.solveMs),
      }),
    )

    expect(model.recipes.length).toBeGreaterThan(7000)
    expect(stage.assignmentVariableCount).toBeGreaterThan(40000)
  },
  90000,
)
