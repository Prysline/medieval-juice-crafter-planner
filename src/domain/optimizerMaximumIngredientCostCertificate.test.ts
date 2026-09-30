import { describe, expect, it } from 'vitest'
import type { RecipeCandidate } from '../types'
import {
  prepareMaximumIngredientCostStageCertificate,
} from './optimizerCertificates'
import { highsSolverAdapter } from './optimizerHighsSolver'
import type {
  BatchOptimizationModel,
  EligibleOptimizationRecipe,
  OptimizationRequest,
} from './optimizerModel'

function candidate(id: string): RecipeCandidate {
  return {
    id,
    name: id,
    source: 'observed',
    unlockedAt: 'seasoner-unlocked',
    salePrice: 10,
    ingredients: ['檸檬'],
    effects: [{ name: '甜味', value: 1 }],
    equipment: [],
  }
}

function eligibleRecipe(
  id: string,
  cost: number,
  eligibleCustomerIds: string[],
): EligibleOptimizationRecipe {
  return {
    candidate: candidate(id),
    juiceUnitIngredientCost: cost,
    eligibleCustomerIds,
    productionPath: {
      ingredientIds: ['lemon'],
      edges: [],
    },
  }
}

function request(
  priorities: OptimizationRequest['priorities'] = [
    'minimum-waste',
    'maximum-ingredient-cost',
  ],
): OptimizationRequest {
  return {
    customerIds: ['a', 'b'],
    currentProgress: 'seasoner-unlocked',
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
      'ibex-statue': 0,
    },
    formalCustomerIds: ['a', 'b'],
    candidatePolicy: 'observed-only',
    objective: priorities[0] ?? 'minimum-waste',
    priorities,
    availableJuiceJarCount: 2,
  }
}

function domain(
  recipes: EligibleOptimizationRecipe[],
  requestOverrides: Partial<OptimizationRequest> = {},
): BatchOptimizationModel {
  return {
    request: {
      ...request(),
      ...requestOverrides,
    },
    serviceableCustomerIds: ['a', 'b'],
    unresolvedCustomerIds: [],
    excludedSuppliedCustomerIds: [],
    recipes,
  }
}

describe('maximum ingredient cost exact certificate', () => {
  it('keeps every tied per-customer maximum and computes the separable upper bound', () => {
    const plan = prepareMaximumIngredientCostStageCertificate(
      domain([
        eligibleRecipe('cheap', 5, ['a', 'b']),
        eligibleRecipe('max-a', 11, ['a']),
        eligibleRecipe('max-a-tie', 11, ['a']),
        eligibleRecipe('max-b', 13, ['b']),
      ]),
    )

    expect(plan).not.toBeNull()
    expect(plan?.upperBound).toBe(24)
    expect(plan?.originalAssignmentCount).toBe(5)
    expect(plan?.certificateAssignmentCount).toBe(3)

    const eligibleByRecipe = Object.fromEntries(
      (plan?.stageDomain.recipes ?? []).map((recipe) => [
        recipe.candidate.id,
        recipe.eligibleCustomerIds,
      ]),
    )
    expect(eligibleByRecipe).toEqual({
      cheap: [],
      'max-a': ['a'],
      'max-a-tie': ['a'],
      'max-b': ['b'],
    })
  })

  it('does not apply the full-service upper-bound certificate to inventory-only partial planning', () => {
    expect(
      prepareMaximumIngredientCostStageCertificate(
        domain(
          [eligibleRecipe('shared', 10, ['a', 'b'])],
          {
            materialSourceMode: 'inventory-only',
            materialInventory: {
              ingredientUnits: {},
              intermediateJuiceUnits: {},
            },
          },
        ),
      ),
    ).toBeNull()
  })

  it('falls back to the full exact Stage 2 when independent customer maxima cannot preserve the minimum-waste fix', async () => {
    const result = await highsSolverAdapter.solve(
      domain([
        eligibleRecipe('shared-cheap', 5, ['a', 'b']),
        eligibleRecipe('max-a', 11, ['a']),
        eligibleRecipe('max-b', 13, ['b']),
      ]),
      ['minimum-waste', 'maximum-ingredient-cost'],
    )

    expect(result.assignments).toEqual([
      { customerId: 'a', recipeId: 'shared-cheap' },
      { customerId: 'b', recipeId: 'shared-cheap' },
    ])
    expect(result.productionUnitsByRecipeId).toEqual({
      'shared-cheap': 1,
    })
    expect(result.metrics.totalProductionUnits).toBe(1)
  })
})
