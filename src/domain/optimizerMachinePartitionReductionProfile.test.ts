import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { prepareMinimumCostStageCertificate } from './optimizerCertificates'
import { buildOptimizationModel, type OptimizationRequest } from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import type { EligibleOptimizationRecipe } from './optimizerModel'
import type { ProductionStepKind } from './productionPlan'

function serviceKey(recipe: EligibleOptimizationRecipe): string {
  return [...recipe.eligibleCustomerIds].sort().join('\u001e')
}

function partitionSignature(
  recipe: EligibleOptimizationRecipe,
  kinds: ReadonlySet<ProductionStepKind>,
): string {
  const multiplicity = new Map<string, number>()
  for (const edge of recipe.productionPath.edges) {
    if (!kinds.has(edge.kind)) continue
    const key = `${edge.kind}\u001f${edge.key}`
    multiplicity.set(key, (multiplicity.get(key) ?? 0) + 1)
  }
  return [...multiplicity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}\u001d${count}`)
    .join('\u001c')
}

function exactPartitionGroupCount(
  recipes: readonly EligibleOptimizationRecipe[],
  kinds: ReadonlySet<ProductionStepKind>,
): number {
  return new Set(
    recipes.map((recipe) =>
      [
        serviceKey(recipe),
        recipe.juiceUnitIngredientCost,
        partitionSignature(recipe, kinds),
      ].join('\u001b'),
    ),
  ).size
}

function serviceCostGroupCount(
  recipes: readonly EligibleOptimizationRecipe[],
): number {
  return new Set(
    recipes.map((recipe) =>
      `${serviceKey(recipe)}\u001b${recipe.juiceUnitIngredientCost}`,
    ),
  ).size
}

function assignmentEdgeCount(
  recipes: readonly EligibleOptimizationRecipe[],
): number {
  return recipes.reduce(
    (total, recipe) => total + recipe.eligibleCustomerIds.length,
    0,
  )
}

describe('machine certificate partition reduction profile', () => {
  it('measures exact grouping opportunities on the canonical Blender minimum-cost continuation', () => {
    const customerIds = canonicalCustomers
      .filter((customer) =>
        customerVillageIsAvailable(customer, 'juice-blender-unlocked'),
      )
      .map((customer) => customer.id)
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
      priorities: [
        'minimum-cost',
        'minimum-machine-operations',
        'minimum-jar-fill-operations',
      ],
      availableJuiceJarCount: 2,
    }
    const pool = buildRecipeCandidatePool(request.currentProgress)
    const domain = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool: pool,
    })
    const certificate = prepareMinimumCostStageCertificate(domain)

    expect(certificate).not.toBeNull()
    if (!certificate) return

    const continuation = certificate.continuationDomain.recipes
    const throughSeasoningKinds = new Set<ProductionStepKind>([
      'juicing',
      'seasoning',
    ])
    const blendingKinds = new Set<ProductionStepKind>(['blending'])
    const noProductionCaps = continuation.every(
      (recipe) => recipe.maxProductionUnits === undefined,
    )
    const profile = {
      originalRecipeCount: certificate.originalRecipeCount,
      originalAssignmentEdgeCount: assignmentEdgeCount(domain.recipes),
      minimumCostRepresentativeRecipeCount:
        certificate.representativeRecipeCount,
      continuationRecipeCount: certificate.frontierRecipeCount,
      continuationAssignmentEdgeCount: assignmentEdgeCount(continuation),
      continuationServiceCostGroupCount:
        serviceCostGroupCount(continuation),
      throughSeasoningExactGroupCount: exactPartitionGroupCount(
        continuation,
        throughSeasoningKinds,
      ),
      blendingExactGroupCount: exactPartitionGroupCount(
        continuation,
        blendingKinds,
      ),
      finalizingServiceCostGroupCount:
        serviceCostGroupCount(continuation),
      noProductionCaps,
    }

    console.info(
      `MACHINE_PARTITION_REDUCTION_PROFILE ${JSON.stringify(profile)}`,
    )

    expect(noProductionCaps).toBe(true)
    expect(profile.continuationRecipeCount).toBeGreaterThan(0)
    expect(profile.throughSeasoningExactGroupCount)
      .toBeLessThanOrEqual(profile.continuationRecipeCount)
    expect(profile.blendingExactGroupCount)
      .toBeLessThanOrEqual(profile.continuationRecipeCount)
    expect(profile.finalizingServiceCostGroupCount)
      .toBeLessThan(profile.continuationRecipeCount)
  })
})
