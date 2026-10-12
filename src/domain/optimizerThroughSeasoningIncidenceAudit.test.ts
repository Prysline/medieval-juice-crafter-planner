import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'
import { prepareMinimumCostStageCertificate } from './optimizerCertificates'

function serviceCostKey(recipe: EligibleOptimizationRecipe): string {
  return `${[...recipe.eligibleCustomerIds].sort().join('\u001e')}\u001d${recipe.juiceUnitIngredientCost}`
}

function throughSeasoningIncidenceKey(
  recipe: EligibleOptimizationRecipe,
): string {
  const multiplicityByEdgeKey = new Map<string, number>()
  for (const edge of recipe.productionPath.edges) {
    if (edge.kind !== 'juicing' && edge.kind !== 'seasoning') continue
    multiplicityByEdgeKey.set(
      edge.key,
      (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
    )
  }
  return [...multiplicityByEdgeKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([edgeKey, multiplicity]) => `${edgeKey}:${multiplicity}`)
    .join('\u001f')
}

describe('throughSeasoning operation-incidence audit', () => {
  it('reports exact quotient potential after the minimum-cost frontier', () => {
    const customerIds = canonicalCustomers.map((customer) => customer.id)
    const request: OptimizationRequest = {
      customerIds,
      currentProgress: 'juice-blender-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
        'ibex-statue': 0,
      },
      formalCustomerIds: customerIds,
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-cost',
      priorities: ['minimum-cost', 'minimum-machine-operations'],
      availableJuiceJarCount: 2,
    }
    const domain = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool: buildRecipeCandidatePool(request.currentProgress),
    })
    const stage1 = prepareMinimumCostStageCertificate(domain)
    expect(stage1).not.toBeNull()

    const recipes = stage1!.continuationDomain.recipes
    const serviceCostGroups = new Map<string, number>()
    const incidenceGroups = new Map<string, string[]>()

    for (const recipe of recipes) {
      const serviceCost = serviceCostKey(recipe)
      serviceCostGroups.set(
        serviceCost,
        (serviceCostGroups.get(serviceCost) ?? 0) + 1,
      )
      const exactKey = `${serviceCost}\u001c${throughSeasoningIncidenceKey(recipe)}`
      const ids = incidenceGroups.get(exactKey)
      if (ids) ids.push(recipe.candidate.id)
      else incidenceGroups.set(exactKey, [recipe.candidate.id])
    }

    const sizes = [...incidenceGroups.values()]
      .map((group) => group.length)
      .sort((a, b) => b - a)
    const mergeableGroups = sizes.filter((size) => size > 1)
    const mergeableRecipes = mergeableGroups.reduce(
      (total, size) => total + size - 1,
      0,
    )

    console.log(
      'THROUGH_SEASONING_INCIDENCE_AUDIT',
      JSON.stringify({
        recipeCount: recipes.length,
        serviceCostGroupCount: serviceCostGroups.size,
        exactIncidenceGroupCount: incidenceGroups.size,
        mergeableGroupCount: mergeableGroups.length,
        mergeableRecipes,
        reductionRatio:
          recipes.length === 0 ? 0 : mergeableRecipes / recipes.length,
        largestGroups: sizes.slice(0, 20),
      }),
    )

    expect(incidenceGroups.size).toBeLessThanOrEqual(recipes.length)
  })
})
