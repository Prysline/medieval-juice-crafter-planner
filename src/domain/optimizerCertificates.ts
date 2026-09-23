import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
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


export interface RecipeUnitSelection {
  recipeId: string
  units: number
}

export interface MachineOperationBreakdown {
  juicing: number
  seasoning: number
  blending: number
  finalizing: number
  total: number
}

export interface MachineWitnessRepairStep {
  from: number
  to: number
  sourceRecipeId: string
  targetRecipeId: string
  transferredUnits: number
}

function customerBitsForDomain(
  domain: BatchOptimizationModel,
): Map<string, bigint> {
  return new Map(
    domain.serviceableCustomerIds.map(
      (customerId, index) => [customerId, 1n << BigInt(index)],
    ),
  )
}

function edgeMultiplicityForRecipe(
  recipe: EligibleOptimizationRecipe,
): Map<string, number> {
  const multiplicity = new Map<string, number>()
  for (const edge of recipe.productionPath.edges) {
    multiplicity.set(
      edge.key,
      (multiplicity.get(edge.key) ?? 0) + 1,
    )
  }
  return multiplicity
}

export function machineOperationBreakdownForSelection(
  domain: BatchOptimizationModel,
  selections: RecipeUnitSelection[],
): MachineOperationBreakdown {
  const recipeById = new Map(
    domain.recipes.map((recipe) => [
      recipe.candidate.id,
      recipe,
    ]),
  )
  const edgeQuantityByKey = new Map<string, number>()
  const edgeKindByKey = new Map<string, string>()

  for (const selection of selections) {
    const recipe = recipeById.get(selection.recipeId)
    if (!recipe) continue
    const units = Math.max(0, Math.round(selection.units))
    if (units === 0) continue

    for (const edge of recipe.productionPath.edges) {
      edgeQuantityByKey.set(
        edge.key,
        (edgeQuantityByKey.get(edge.key) ?? 0) + units,
      )
      edgeKindByKey.set(edge.key, edge.kind)
    }
  }

  const breakdown: MachineOperationBreakdown = {
    juicing: 0,
    seasoning: 0,
    blending: 0,
    finalizing: 0,
    total: 0,
  }

  for (const [edgeKey, quantity] of edgeQuantityByKey) {
    if (quantity <= 0) continue
    const operations = Math.ceil(
      quantity / PROCESSING_STACK_CAPACITY,
    )
    const kind = edgeKindByKey.get(edgeKey)
    if (kind === 'juicing') breakdown.juicing += operations
    if (kind === 'seasoning') breakdown.seasoning += operations
    if (kind === 'blending') breakdown.blending += operations
    if (kind === 'finalizing') breakdown.finalizing += operations
    breakdown.total += operations
  }

  return breakdown
}

function improveMachineWitnessOneStep(
  domain: BatchOptimizationModel,
  selections: RecipeUnitSelection[],
  fixedMinimumCost: number,
  targetLowerBound: number,
): {
  selections: RecipeUnitSelection[]
  step: MachineWitnessRepairStep | null
} {
  const normalizedSelections = selections
    .map((selection) => ({
      recipeId: selection.recipeId,
      units: Math.max(0, Math.round(selection.units)),
    }))
    .filter((selection) => selection.units > 0)
  const baseBreakdown = machineOperationBreakdownForSelection(
    domain,
    normalizedSelections,
  )
  const unitsByRecipeId = new Map(
    normalizedSelections.map((selection) => [
      selection.recipeId,
      selection.units,
    ]),
  )
  const recipeById = new Map(
    domain.recipes.map((recipe) => [
      recipe.candidate.id,
      recipe,
    ]),
  )
  const customerBits = customerBitsForDomain(domain)
  const recipesByServiceMask = new Map<
    bigint,
    EligibleOptimizationRecipe[]
  >()
  for (const recipe of domain.recipes) {
    const mask = serviceMaskForRecipe(recipe, customerBits)
    const group = recipesByServiceMask.get(mask)
    if (group) group.push(recipe)
    else recipesByServiceMask.set(mask, [recipe])
  }

  const multiplicityByRecipeId = new Map<
    string,
    Map<string, number>
  >()
  const edgeQuantityByKey = new Map<string, number>()

  const multiplicityFor = (recipe: EligibleOptimizationRecipe) => {
    const cached = multiplicityByRecipeId.get(recipe.candidate.id)
    if (cached) return cached
    const multiplicity = edgeMultiplicityForRecipe(recipe)
    multiplicityByRecipeId.set(recipe.candidate.id, multiplicity)
    return multiplicity
  }

  for (const selection of normalizedSelections) {
    const recipe = recipeById.get(selection.recipeId)
    if (!recipe) continue
    for (const [edgeKey, multiplicity] of multiplicityFor(recipe)) {
      edgeQuantityByKey.set(
        edgeKey,
        (edgeQuantityByKey.get(edgeKey) ?? 0) +
          selection.units * multiplicity,
      )
    }
  }

  const maxJuiceUnitsPerRecipe = Math.max(
    1,
    Math.ceil(domain.serviceableCustomerIds.length / 2),
  )
  let best:
    | {
        machineOperations: number
        sourceRecipeId: string
        targetRecipeId: string
        transferredUnits: number
      }
    | null = null

  for (const sourceSelection of normalizedSelections) {
    const sourceRecipe = recipeById.get(sourceSelection.recipeId)
    if (!sourceRecipe) continue
    const serviceMask = serviceMaskForRecipe(
      sourceRecipe,
      customerBits,
    )
    const sourceMultiplicity = multiplicityFor(sourceRecipe)

    for (const targetRecipe of recipesByServiceMask.get(serviceMask) ?? []) {
      if (targetRecipe.candidate.id === sourceRecipe.candidate.id) {
        continue
      }
      if (
        targetRecipe.juiceUnitIngredientCost !==
        sourceRecipe.juiceUnitIngredientCost
      ) {
        continue
      }

      const targetCurrentUnits =
        unitsByRecipeId.get(targetRecipe.candidate.id) ?? 0
      const customerCapacityUpperBound = Math.max(
        1,
        Math.ceil(targetRecipe.eligibleCustomerIds.length / 2),
      )
      const costUpperBound =
        targetRecipe.juiceUnitIngredientCost > 0
          ? Math.floor(
              fixedMinimumCost /
                targetRecipe.juiceUnitIngredientCost,
            )
          : maxJuiceUnitsPerRecipe
      const targetUpperBound = Math.max(
        0,
        Math.min(
          maxJuiceUnitsPerRecipe,
          customerCapacityUpperBound,
          costUpperBound,
        ),
      )
      const maxTransfer = Math.min(
        sourceSelection.units,
        Math.max(0, targetUpperBound - targetCurrentUnits),
      )
      if (maxTransfer <= 0) continue

      const targetMultiplicity = multiplicityFor(targetRecipe)
      const affectedEdgeKeys = new Set([
        ...sourceMultiplicity.keys(),
        ...targetMultiplicity.keys(),
      ])

      for (
        let transferredUnits = 1;
        transferredUnits <= maxTransfer;
        transferredUnits += 1
      ) {
        let operationDelta = 0
        for (const edgeKey of affectedEdgeKeys) {
          const oldQuantity = edgeQuantityByKey.get(edgeKey) ?? 0
          const newQuantity =
            oldQuantity +
            transferredUnits *
              (
                (targetMultiplicity.get(edgeKey) ?? 0) -
                (sourceMultiplicity.get(edgeKey) ?? 0)
              )
          operationDelta +=
            Math.ceil(
              Math.max(0, newQuantity) /
                PROCESSING_STACK_CAPACITY,
            ) -
            Math.ceil(
              oldQuantity / PROCESSING_STACK_CAPACITY,
            )
        }

        const machineOperations =
          baseBreakdown.total + operationDelta
        if (
          machineOperations < targetLowerBound ||
          machineOperations >= baseBreakdown.total
        ) {
          continue
        }
        if (
          !best ||
          machineOperations < best.machineOperations
        ) {
          best = {
            machineOperations,
            sourceRecipeId: sourceRecipe.candidate.id,
            targetRecipeId: targetRecipe.candidate.id,
            transferredUnits,
          }
        }
      }
    }
  }

  if (!best) {
    return {
      selections: normalizedSelections,
      step: null,
    }
  }

  const repairedUnits = new Map(unitsByRecipeId)
  repairedUnits.set(
    best.sourceRecipeId,
    (repairedUnits.get(best.sourceRecipeId) ?? 0) -
      best.transferredUnits,
  )
  repairedUnits.set(
    best.targetRecipeId,
    (repairedUnits.get(best.targetRecipeId) ?? 0) +
      best.transferredUnits,
  )

  return {
    selections: [...repairedUnits.entries()]
      .filter(([, units]) => units > 0)
      .map(([recipeId, units]) => ({ recipeId, units })),
    step: {
      from: baseBreakdown.total,
      to: best.machineOperations,
      sourceRecipeId: best.sourceRecipeId,
      targetRecipeId: best.targetRecipeId,
      transferredUnits: best.transferredUnits,
    },
  }
}

/**
 * This is only a witness search. It never proves the lower bound itself.
 * Every returned candidate must still pass the full fixed-x solver model
 * before a machine-operation certificate can be accepted.
 */
export function repairMachineOperationWitness(
  domain: BatchOptimizationModel,
  initialSelections: RecipeUnitSelection[],
  fixedMinimumCost: number,
  targetLowerBound: number,
  maxSteps = 4,
): {
  selections: RecipeUnitSelection[]
  breakdown: MachineOperationBreakdown
  steps: MachineWitnessRepairStep[]
} {
  let selections = initialSelections
  const steps: MachineWitnessRepairStep[] = []

  for (let index = 0; index < maxSteps; index += 1) {
    const breakdown = machineOperationBreakdownForSelection(
      domain,
      selections,
    )
    if (breakdown.total === targetLowerBound) break

    const improved = improveMachineWitnessOneStep(
      domain,
      selections,
      fixedMinimumCost,
      targetLowerBound,
    )
    if (!improved.step) break
    selections = improved.selections
    steps.push(improved.step)
  }

  return {
    selections,
    breakdown: machineOperationBreakdownForSelection(
      domain,
      selections,
    ),
    steps,
  }
}
