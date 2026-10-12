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

function finalizingReductionIsSafe(
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

function representativesByServiceAndCost(
  domain: BatchOptimizationModel,
): EligibleOptimizationRecipe[] {
  const representativeByKey = new Map<
    string,
    EligibleOptimizationRecipe
  >()

  for (const recipe of domain.recipes) {
    const key = serviceCostKey(recipe)
    if (!representativeByKey.has(key)) {
      representativeByKey.set(key, recipe)
    }
  }

  return [...representativeByKey.values()]
}

/**
 * Build a certificate-local exact quotient for the finalizing lower bound.
 *
 * This reduction is intentionally not used for through-seasoning or blending:
 * same-runner production profiling showed that shrinking through-seasoning
 * made HiGHS slower despite reducing the structural model, while blending had
 * negligible structural equivalence.
 *
 * For finalizing, every original recipe must own exactly one recipe-identity
 * finalizing edge and the stage must have no per-recipe stock/cap/jar hard
 * constraints. Recipes with the same service set and fixed minimum-cost
 * coefficient are then interchangeable for this lower bound. Consolidating
 * their units onto one real representative cannot increase
 * sum(ceil(units / stackCapacity)); the representative itself is an original
 * feasible recipe, so the reduced and original lower-bound optima are equal.
 *
 * The full original domain remains authoritative for witness repair and the
 * fixed-x verification solve that closes the certificate.
 */
export function reduceMachineCertificatePartitionDomain(
  domain: BatchOptimizationModel,
  partition: MachineCertificatePartitionSpec,
): BatchOptimizationModel {
  if (partition.key !== 'finalizing') return domain
  if (!sameKinds(partition.kinds, ['finalizing'])) return domain
  if (!finalizingReductionIsSafe(domain)) return domain
  if (!finalizingEdgesAreRecipeIdentityUnique(domain)) {
    return domain
  }

  const recipes = representativesByServiceAndCost(domain)
  return recipes.length < domain.recipes.length
    ? { ...domain, recipes }
    : domain
}