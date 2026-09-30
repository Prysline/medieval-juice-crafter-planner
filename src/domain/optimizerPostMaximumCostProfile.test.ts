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

    const profileStartedAt = performance.now()
    const profile =
      await profilePostMaximumCostGenericContinuation(model, 10.5)
    const boundedContinuationMs =
      performance.now() - profileStartedAt

    console.info(
      '[post-maximum-cost-after]',
      JSON.stringify({
        domainBuildMs: Math.round(domainBuildMs),
        boundedContinuationMs: Math.round(boundedContinuationMs),
        boundedEndToEndThroughMachineBlockerMs: Math.round(
          domainBuildMs + boundedContinuationMs,
        ),
        ...profile,
        productionCostBuildMs:
          Math.round(profile.productionCostBuildMs),
        productionCostSerializeMs:
          Math.round(profile.productionCostSerializeMs),
        productionCostParseMs:
          Math.round(profile.productionCostParseMs),
        productionCostSolveMs:
          Math.round(profile.productionCostSolveMs),
        machineBuildMs:
          profile.machineBuildMs === null
            ? null
            : Math.round(profile.machineBuildMs),
        machineSerializeMs:
          profile.machineSerializeMs === null
            ? null
            : Math.round(profile.machineSerializeMs),
        machineParseMs:
          profile.machineParseMs === null
            ? null
            : Math.round(profile.machineParseMs),
        machineSolveMs:
          profile.machineSolveMs === null
            ? null
            : Math.round(profile.machineSolveMs),
      }),
    )

    expect(profile.recipeCount).toBeGreaterThan(7000)
    expect(profile.customerCount).toBeGreaterThan(60)
    expect(profile.minimumWasteOptimum).toBe(35)
    expect(profile.maximumIngredientCostOptimum).toBe(3853)
    expect(profile.maximumCostAssignmentVariableCount).toBe(
      profile.productionCostAssignmentVariableCount,
    )
    expect(profile.productionCostGroupCount).toBeGreaterThan(1000)
    expect(profile.productionCostStatus).toBe('optimal')
    expect(profile.productionCostObjectiveValue).toBe(1948)
    expect(profile.machineAssignmentVariableCount).toBeGreaterThan(
      40000,
    )
    expect(profile.machineRecipeVariableCount).toBeGreaterThan(7000)
  },
  180000,
)
