import { finalizingEdgesAreRecipeIdentityUnique } from './optimizerCertificates'
import {
  normalizedInitialCarriedJuiceJars,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
} from './optimizerModel'
import type { ProductionStepKind } from './productionPlan'

export type MachineCertificatePartitionKey =
  | 'throughSeasoning'
  | 'blending'
  | 'finalizing'

export interface MachineCertificatePartitionSpec {
  key: MachineCertificatePartitionKey
  kinds: readonly ProductionStepKind[]
}

function sameKinds(
  actual: readonly ProductionStepKind[],
  expected: readonly ProductionStepKind[],
): boolean {
  const left = [...new Set(actual)].sort()
  const right = [...new Set(expected)].sort()
  return (
    left.length === right.length &&
    left.every((kind, index) => kind === right[index])
  )
}

function partitionReductionIsSafe(
  domain: BatchOptimizationModel,
): boolean {
  if (domain.request.materialSourceMode === 'inventory-only') {
    return false
  }
  if (
    domain.recipes.some(
      (recipe) =>
        recipe.maxProductionUnits !== undefined ||
        (recipe.initialFinishedServings ?? 0) > 0 ||
        !Number.isFinite(recipe.juiceUnitIngredientCost) ||
        recipe.juiceUnitIngredientCost < 0,
    )
  ) {
    return false
  }

  const initialJars = normalizedInitialCarriedJuiceJars(
    domain.request,
  )
  const emptyJarCount = initialJars.filter(
    (jar) => !jar.recipeId || jar.servings <= 0,
  ).length
  if (emptyJarCount === 0) return false

  const maxJarTypeSwitches =
    domain.request.constraints?.maxJarTypeSwitches
  if (
    typeof maxJarTypeSwitches === 'number' &&
    Number.isFinite(maxJarTypeSwitches)
  ) {
    return false
  }

  const maxJarFillOperations =
    domain.request.constraints?.maxJarFillOperations
  if (
    typeof maxJarFillOperations === 'number' &&
    Number.isFinite(maxJarFillOperations)
  ) {
    return false
  }

  return true
}

function serviceCostKey(
  recipe: EligibleOptimizationRecipe,
): string {
  const serviceKey = [...recipe.eligibleCustomerIds]
    .sort()
    .join('\u001e')
  return `${serviceKey}\u001d${recipe.juiceUnitIngredientCost}`
}

function partitionOperationSignature(
  recipe: EligibleOptimizationRecipe,
  kinds: ReadonlySet<ProductionStepKind>,
): string {
  const multiplicityByEdge = new Map<string, number>()

  for (const edge of recipe.productionPath.edges) {
    if (!kinds.has(edge.kind)) continue
    const key = `${edge.kind}\u001f${edge.key}`
    multiplicityByEdge.set(
      key,
      (multiplicityByEdge.get(key) ?? 0) + 1,
    )
  }

  return [...multiplicityByEdge.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, multiplicity]) => `${key}\u001c${multiplicity}`)
    .join('\u001b')
}

function representativesByKey(
  domain: BatchOptimizationModel,
  keyForRecipe: (recipe: EligibleOptimizationRecipe) => string,
): EligibleOptimizationRecipe[] {
  const representativeByKey = new Map<
    string,
    EligibleOptimizationRecipe
  >()

  for (const recipe of domain.recipes) {
    const key = keyForRecipe(recipe)
    if (!representativeByKey.has(key)) {
      representativeByKey.set(key, recipe)
    }
  }

  return [...representativeByKey.values()]
}

/**
 * Build a certificate-local exact quotient of real recipe identities.
 *
 * The quotient is deliberately limited to lower-bound partitions whose
 * objective cannot distinguish recipes inside one group. The full original
 * domain remains authoritative for witness repair and fixed-x verification.
 *
 * throughSeasoning:
 * - same service set
 * - same fixed minimum-cost coefficient
 * - same selected operation-edge multiplicity
 *
 * finalizing:
 * - same service set
 * - same fixed minimum-cost coefficient
 * - one recipe-unique finalizing edge per original recipe
 *
 * Consolidating interchangeable finalizing production onto one real
 * representative cannot increase sum(ceil(x / stackCapacity)); conversely
 * the representative is itself an original recipe, so the reduced optimum
 * cannot beat the original optimum. The two optima are therefore equal.
 */
export function reduceMachineCertificatePartitionDomain(
  domain: BatchOptimizationModel,
  partition: MachineCertificatePartitionSpec,
): BatchOptimizationModel {
  if (!partitionReductionIsSafe(domain)) return domain

  if (partition.key === 'blending') return domain

  if (partition.key === 'throughSeasoning') {
    if (
      !sameKinds(partition.kinds, ['juicing', 'seasoning'])
    ) {
      return domain
    }
    const kinds = new Set(partition.kinds)
    const recipes = representativesByKey(
      domain,
      (recipe) =>
        `${serviceCostKey(recipe)}\u001a${partitionOperationSignature(recipe, kinds)}`,
    )
    return recipes.length < domain.recipes.length
      ? { ...domain, recipes }
      : domain
  }

  if (!sameKinds(partition.kinds, ['finalizing'])) {
    return domain
  }
  if (!finalizingEdgesAreRecipeIdentityUnique(domain)) {
    return domain
  }

  const recipes = representativesByKey(
    domain,
    serviceCostKey,
  )
  return recipes.length < domain.recipes.length
    ? { ...domain, recipes }
    : domain
}
