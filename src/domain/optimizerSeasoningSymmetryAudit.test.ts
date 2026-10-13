import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { prepareMinimumCostStageCertificate } from './optimizerCertificates'
import {
  buildOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import type { ProductionStepKind } from './productionPlan'

const diagnosisEnv =
  (
    globalThis as {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env ?? {}

const diagnosisIt =
  diagnosisEnv.P4_SEASONING_SYMMETRY_AUDIT === '1' ? it : it.skip

interface GroupStats {
  groupCount: number
  singletonGroupCount: number
  mergeableGroupCount: number
  removableRecipeCount: number
  largestGroupSize: number
  largestGroupSizes: number[]
}

function serviceCostKey(recipe: EligibleOptimizationRecipe): string {
  const serviceKey = [...recipe.eligibleCustomerIds].sort().join('\u001e')
  return `${serviceKey}\u001d${recipe.juiceUnitIngredientCost}`
}

function edgeMultiplicitySignature(
  recipe: EligibleOptimizationRecipe,
  kinds: ReadonlySet<ProductionStepKind>,
): string {
  const multiplicityByKey = new Map<string, number>()
  for (const edge of recipe.productionPath.edges) {
    if (!kinds.has(edge.kind)) continue
    multiplicityByKey.set(
      edge.key,
      (multiplicityByKey.get(edge.key) ?? 0) + 1,
    )
  }
  return [...multiplicityByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, multiplicity]) => `${key}:${multiplicity}`)
    .join('\u001e')
}

function seasoningEdgeSetSignature(
  recipe: EligibleOptimizationRecipe,
): string {
  return recipe.productionPath.edges
    .filter((edge) => edge.kind === 'seasoning')
    .map((edge) => edge.key)
    .sort()
    .join('\u001e')
}

function seasoningRootSetSignature(
  recipe: EligibleOptimizationRecipe,
): string {
  return [
    ...new Set(
      recipe.productionPath.edges
        .filter((edge) => edge.kind === 'seasoning')
        .flatMap((edge) =>
          edge.toIngredientIds[0] ? [edge.toIngredientIds[0]] : [],
        ),
    ),
  ]
    .sort()
    .join('\u001e')
}

function groupStats(
  recipes: readonly EligibleOptimizationRecipe[],
  keyForRecipe: (recipe: EligibleOptimizationRecipe) => string,
): GroupStats {
  const counts = new Map<string, number>()
  for (const recipe of recipes) {
    const key = keyForRecipe(recipe)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const sizes = [...counts.values()].sort((left, right) => right - left)
  const singletonGroupCount = sizes.filter((size) => size === 1).length
  const mergeableGroupCount = sizes.length - singletonGroupCount
  return {
    groupCount: sizes.length,
    singletonGroupCount,
    mergeableGroupCount,
    removableRecipeCount: recipes.length - sizes.length,
    largestGroupSize: sizes[0] ?? 0,
    largestGroupSizes: sizes.slice(0, 10),
  }
}

describe('diagnosis-only seasoning certificate symmetry audit', () => {
  diagnosisIt('compares historical throughSeasoning incidence classes with seasoning-only exact signatures', () => {
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
    const throughSeasoningKinds = new Set<ProductionStepKind>([
      'juicing',
      'seasoning',
    ])
    const seasoningKinds = new Set<ProductionStepKind>(['seasoning'])

    const serviceCost = groupStats(recipes, serviceCostKey)
    const historicalThroughSeasoningIncidence = groupStats(
      recipes,
      (recipe) =>
        `${serviceCostKey(recipe)}\u001c${edgeMultiplicitySignature(
          recipe,
          throughSeasoningKinds,
        )}`,
    )
    const seasoningMultiplicity = groupStats(
      recipes,
      (recipe) =>
        `${serviceCostKey(recipe)}\u001c${edgeMultiplicitySignature(
          recipe,
          seasoningKinds,
        )}`,
    )
    const seasoningEdgeSet = groupStats(
      recipes,
      (recipe) =>
        `${serviceCostKey(recipe)}\u001c${seasoningEdgeSetSignature(recipe)}`,
    )
    const seasoningRootSet = groupStats(
      recipes,
      (recipe) =>
        `${serviceCostKey(recipe)}\u001c${seasoningRootSetSignature(recipe)}`,
    )

    expect(recipes).toHaveLength(3076)
    expect(serviceCost.groupCount).toBe(301)
    expect(historicalThroughSeasoningIncidence.groupCount).toBe(1429)
    expect(seasoningMultiplicity.groupCount).toBe(
      seasoningEdgeSet.groupCount,
    )

    console.info(
      `[P4 seasoning symmetry audit] ${JSON.stringify({
        recipeCount: recipes.length,
        serviceCost,
        historicalThroughSeasoningIncidence,
        seasoningMultiplicity,
        seasoningEdgeSet,
        seasoningRootSet,
        seasoningOnlyDiffersFromHistorical:
          seasoningEdgeSet.groupCount !==
          historicalThroughSeasoningIncidence.groupCount,
      })}`,
    )
  })
})
