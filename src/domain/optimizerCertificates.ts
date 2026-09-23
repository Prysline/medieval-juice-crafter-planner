import {
  normalizedInitialCarriedJuiceJars,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
} from './optimizerModel'

export interface MinimumCostStageCertificatePlan {
  stageDomain: BatchOptimizationModel
  continuationDomain: BatchOptimizationModel
  originalRecipeCount: number
  frontierRecipeCount: number
  representativeRecipeCount: number
}

function serviceMaskForRecipe(
  recipe: EligibleOptimizationRecipe,
  customerBitById: Map<string, bigint>,
): bigint {
  return recipe.eligibleCustomerIds.reduce(
    (mask, customerId) =>
      mask | (customerBitById.get(customerId) ?? 0n),
    0n,
  )
}

function hasIdentitySensitiveJarConstraint(
  domain: BatchOptimizationModel,
): boolean {
  const initialJars = normalizedInitialCarriedJuiceJars(
    domain.request,
  )
  const emptyJarCount = initialJars.filter(
    (jar) => !jar.recipeId || jar.servings <= 0,
  ).length
  const maxJarTypeSwitches =
    domain.request.constraints?.maxJarTypeSwitches

  return (
    emptyJarCount === 0 ||
    (
      typeof maxJarTypeSwitches === 'number' &&
      Number.isFinite(maxJarTypeSwitches)
    )
  )
}

/**
 * Stage 1 compression is only valid while minimum cost is solved without
 * recipe-identity-sensitive hard feasibility. Later stages must use the
 * continuation domain so equal-cost real recipe identities are available
 * again for machine-operation and jar objectives.
 */
export function prepareMinimumCostStageCertificate(
  domain: BatchOptimizationModel,
): MinimumCostStageCertificatePlan | null {
  if (hasIdentitySensitiveJarConstraint(domain)) return null

  if (
    domain.recipes.some(
      (recipe) =>
        !Number.isFinite(recipe.juiceUnitIngredientCost) ||
        recipe.juiceUnitIngredientCost < 0,
    )
  ) {
    return null
  }

  const customerBitById = new Map(
    domain.serviceableCustomerIds.map(
      (customerId, index) => [customerId, 1n << BigInt(index)],
    ),
  )
  const recipesByServiceMask = new Map<
    bigint,
    EligibleOptimizationRecipe[]
  >()

  for (const recipe of domain.recipes) {
    const mask = serviceMaskForRecipe(recipe, customerBitById)
    const group = recipesByServiceMask.get(mask)
    if (group) {
      group.push(recipe)
    } else {
      recipesByServiceMask.set(mask, [recipe])
    }
  }

  const serviceGroups = [...recipesByServiceMask.entries()].map(
    ([mask, recipes]) => ({
      mask,
      recipes,
      minimumCost: Math.min(
        ...recipes.map((recipe) => recipe.juiceUnitIngredientCost),
      ),
    }),
  )

  const dominatedRecipeIds = new Set<string>()

  for (const group of serviceGroups) {
    let bestSupersetCost = Infinity

    for (const candidateGroup of serviceGroups) {
      if ((candidateGroup.mask & group.mask) !== group.mask) continue
      bestSupersetCost = Math.min(
        bestSupersetCost,
        candidateGroup.minimumCost,
      )
    }

    for (const recipe of group.recipes) {
      if (recipe.juiceUnitIngredientCost > bestSupersetCost) {
        dominatedRecipeIds.add(recipe.candidate.id)
      }
    }
  }

  const frontierRecipes = domain.recipes.filter(
    (recipe) => !dominatedRecipeIds.has(recipe.candidate.id),
  )
  const representativeByServiceMask = new Map<
    bigint,
    EligibleOptimizationRecipe
  >()

  for (const recipe of frontierRecipes) {
    const mask = serviceMaskForRecipe(recipe, customerBitById)
    const current = representativeByServiceMask.get(mask)

    if (
      !current ||
      recipe.juiceUnitIngredientCost <
        current.juiceUnitIngredientCost
    ) {
      representativeByServiceMask.set(mask, recipe)
    }
  }

  return {
    stageDomain: {
      ...domain,
      recipes: [...representativeByServiceMask.values()],
    },
    continuationDomain: {
      ...domain,
      recipes: frontierRecipes,
    },
    originalRecipeCount: domain.recipes.length,
    frontierRecipeCount: frontierRecipes.length,
    representativeRecipeCount: representativeByServiceMask.size,
  }
}
