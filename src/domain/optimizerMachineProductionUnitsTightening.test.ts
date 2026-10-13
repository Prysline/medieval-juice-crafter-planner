import { describe, expect, it } from 'vitest'
import { solveMachineOperationCertificateForCostFix } from './optimizerHighsSolver'
import type {
  BatchOptimizationModel,
  EligibleOptimizationRecipe,
  OptimizationRequest,
} from './optimizerModel'

function freeRecipe(id: string): EligibleOptimizationRecipe {
  return {
    candidate: {
      id,
      name: id,
      source: 'observed',
      unlockedAt: 'opening',
      salePrice: 10,
      ingredients: ['檸檬'],
      effects: [{ name: '酸味', value: 4 }],
      equipment: [],
    },
    juiceUnitIngredientCost: 0,
    eligibleCustomerIds: ['a', 'b'],
    productionPath: {
      ingredientIds: ['lemon'],
      edges: [
        {
          key: 'juice:lemon',
          kind: 'juicing',
          equipment: '柑橘榨汁機',
          fromIngredientIds: [],
          toIngredientIds: ['lemon'],
          addedIngredientId: 'lemon',
        },
        {
          key: 'finish:lemon',
          kind: 'finalizing',
          equipment: '果汁成品台',
          fromIngredientIds: ['lemon'],
          toIngredientIds: ['lemon'],
        },
      ],
    },
  }
}

describe('machine certificate exact production-unit tightening', () => {
  it('falls back to the current certificate when an extra unit still fits the fixed minimum cost', async () => {
    const request: OptimizationRequest = {
      customerIds: ['a', 'b'],
      currentProgress: 'opening',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 0,
        'ibex-statue': 0,
      },
      formalCustomerIds: ['a', 'b'],
      candidatePolicy: 'observed-only',
      objective: 'minimum-cost',
      priorities: ['minimum-cost', 'minimum-machine-operations'],
      availableJuiceJarCount: 1,
    }
    const domain: BatchOptimizationModel = {
      request,
      serviceableCustomerIds: ['a', 'b'],
      unresolvedCustomerIds: [],
      excludedSuppliedCustomerIds: [],
      recipes: [freeRecipe('free-a'), freeRecipe('free-b')],
    }

    const certificate =
      await solveMachineOperationCertificateForCostFix(domain, 0)

    expect(certificate).not.toBeNull()
    expect(certificate?.lowerBounds).toEqual({
      throughSeasoning: 1,
      blending: 0,
      finalizing: 1,
    })
    expect(certificate?.optimum).toBe(2)
    expect(certificate?.verifiedAssignmentCount).toBe(2)
  })
})
