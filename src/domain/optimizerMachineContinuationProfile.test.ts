import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import { finalizingEdgesAreRecipeIdentityUnique } from './optimizerCertificates'

function assignmentKey(
  recipe: ReturnType<typeof buildOptimizationModel>['recipes'][number],
): string {
  return `${[...recipe.eligibleCustomerIds].sort().join('\\u001e')}\\u001d${recipe.juiceUnitIngredientCost}`
}

function edgeSignature(
  recipe: ReturnType<typeof buildOptimizationModel>['recipes'][number],
  kinds: ReadonlySet<string>,
): string {
  const multiplicity = new Map<string, number>()
  for (const edge of recipe.productionPath.edges) {
    if (!kinds.has(edge.kind)) continue
    multiplicity.set(
      `${edge.kind}:${edge.key}`,
      (multiplicity.get(`${edge.kind}:${edge.key}`) ?? 0) + 1,
    )
  }
  return [...multiplicity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}*${count}`)
    .join('\\u001f')
}

it(
  'profiles post-maximum-cost machine-operation quotient shapes',
  () => {
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

    const domain = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool: buildRecipeCandidatePool(currentProgress),
    })

    const assignmentGroups = new Set<string>()
    const throughSeasoningGroups = new Set<string>()
    const blendingGroups = new Set<string>()
    const combinedNonfinalGroups = new Set<string>()

    for (const recipe of domain.recipes) {
      const base = assignmentKey(recipe)
      assignmentGroups.add(base)
      throughSeasoningGroups.add(
        `${base}\\u001c${edgeSignature(
          recipe,
          new Set(['juicing', 'seasoning']),
        )}`,
      )
      blendingGroups.add(
        `${base}\\u001c${edgeSignature(
          recipe,
          new Set(['blending']),
        )}`,
      )
      combinedNonfinalGroups.add(
        `${base}\\u001c${edgeSignature(
          recipe,
          new Set(['juicing', 'seasoning', 'blending']),
        )}`,
      )
    }

    console.info(
      '[machine-quotient-shape]',
      JSON.stringify({
        recipeCount: domain.recipes.length,
        customerCount: domain.serviceableCustomerIds.length,
        assignmentGroupCount: assignmentGroups.size,
        throughSeasoningGroupCount: throughSeasoningGroups.size,
        blendingGroupCount: blendingGroups.size,
        finalizingGroupCount: assignmentGroups.size,
        combinedNonfinalGroupCount: combinedNonfinalGroups.size,
        finalizingEdgesAreRecipeIdentityUnique:
          finalizingEdgesAreRecipeIdentityUnique(domain),
      }),
    )

    expect(domain.recipes.length).toBeGreaterThan(7000)
    expect(domain.serviceableCustomerIds.length).toBeGreaterThan(60)
    expect(finalizingEdgesAreRecipeIdentityUnique(domain)).toBe(true)
  },
  120000,
)
