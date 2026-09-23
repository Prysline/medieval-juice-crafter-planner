import { describe, expect, it } from 'vitest'
import type {
  BatchOptimizationModel,
  EligibleOptimizationRecipe,
  OptimizationRequest,
} from './optimizerModel'
import { prepareMinimumCostStageCertificate } from './optimizerCertificates'

const baseRequest: OptimizationRequest = {
  customerIds: ['a', 'b'],
  currentProgress: 'seasoner-unlocked',
  suppliedCustomerIds: [],
  satisfactionByVillage: {
    'east-harbor': 999,
    'tranquil-fountain': 999,
  },
  formalCustomerIds: ['a', 'b'],
  candidatePolicy: 'observed-only',
  objective: 'minimum-cost',
}

function recipe(
  id: string,
  cost: number,
  eligibleCustomerIds: string[],
): EligibleOptimizationRecipe {
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
    juiceUnitIngredientCost: cost,
    eligibleCustomerIds,
    productionPath: {
      ingredientIds: ['lemon'],
      edges: [],
    },
  }
}

function model(
  recipes: EligibleOptimizationRecipe[],
  request: OptimizationRequest = baseRequest,
): BatchOptimizationModel {
  return {
    request,
    serviceableCustomerIds: ['a', 'b'],
    unresolvedCustomerIds: [],
    excludedSuppliedCustomerIds: [],
    recipes,
  }
}

describe('minimum-cost stage certificate preparation', () => {
  it('removes strictly more expensive service subsets and keeps equal-cost real identities for continuation', () => {
    const domain = model([
      recipe('a-expensive', 5, ['a']),
      recipe('shared-1', 4, ['a', 'b']),
      recipe('shared-2', 4, ['a', 'b']),
      recipe('b-cheap', 3, ['b']),
    ])

    const certificate = prepareMinimumCostStageCertificate(domain)

    expect(certificate).not.toBeNull()
    expect(certificate?.originalRecipeCount).toBe(4)
    expect(certificate?.frontierRecipeCount).toBe(3)
    expect(certificate?.representativeRecipeCount).toBe(2)
    expect(
      certificate?.continuationDomain.recipes.map(
        (entry) => entry.candidate.id,
      ),
    ).toEqual(['shared-1', 'shared-2', 'b-cheap'])
    expect(
      certificate?.stageDomain.recipes.map(
        (entry) => entry.candidate.id,
      ),
    ).toEqual(['shared-1', 'b-cheap'])
  })

  it('falls back when a finite jar-switch hard limit makes recipe identity part of Stage 1 feasibility', () => {
    const certificate = prepareMinimumCostStageCertificate(
      model(
        [recipe('shared', 4, ['a', 'b'])],
        {
          ...baseRequest,
          constraints: {
            maxJarTypeSwitches: 0,
          },
        },
      ),
    )

    expect(certificate).toBeNull()
  })

  it('falls back when every initial jar is occupied and reuse feasibility depends on assignment identity', () => {
    const certificate = prepareMinimumCostStageCertificate(
      model(
        [recipe('shared', 4, ['a', 'b'])],
        {
          ...baseRequest,
          initialAvailableJuiceJars: [
            {
              recipeId: 'legacy',
              servings: 1,
            },
          ],
        },
      ),
    )

    expect(certificate).toBeNull()
  })

  it('allows compression when at least one initial jar is empty and no hard jar-switch limit exists', () => {
    const certificate = prepareMinimumCostStageCertificate(
      model(
        [recipe('shared', 4, ['a', 'b'])],
        {
          ...baseRequest,
          initialAvailableJuiceJars: [
            {
              recipeId: 'legacy',
              servings: 1,
            },
            {
              recipeId: null,
              servings: 0,
            },
          ],
        },
      ),
    )

    expect(certificate).not.toBeNull()
  })
})
