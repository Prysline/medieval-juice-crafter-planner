from pathlib import Path

path = Path('src/domain/optimizerHighsSolver.ts')
source = path.read_text()

marker = """export interface PostMaximumIngredientCostMachineCertificateDiagnosis {"""
helper = """function reducePostMaximumIngredientCostMachinePartitionForDiagnosis(
  domain: BatchOptimizationModel,
  kinds: readonly ProductionStepKind[],
  productionUnits: number,
): BatchOptimizationModel {
  const selectedKinds = new Set(kinds)
  if (
    selectedKinds.size !== 3 ||
    !selectedKinds.has('juicing') ||
    !selectedKinds.has('seasoning') ||
    !selectedKinds.has('blending')
  ) {
    return domain
  }
  if (!maximumIngredientCostGroupedProductionIsSafe(domain)) {
    return domain
  }
  if (
    domain.recipes.some(
      (recipe) =>
        (recipe.initialFinishedServings ?? 0) > 0 ||
        !Number.isFinite(recipe.juiceUnitIngredientCost) ||
        recipe.juiceUnitIngredientCost < 0,
    )
  ) {
    return domain
  }

  const globalSlack =
    productionUnits * 2 - domain.serviceableCustomerIds.length
  if (
    !Number.isInteger(globalSlack) ||
    globalSlack < 0 ||
    globalSlack > 1
  ) {
    return domain
  }

  const representativeByKey = new Map<
    string,
    (typeof domain.recipes)[number]
  >()

  for (const recipe of domain.recipes) {
    const edgeMultiplicity = new Map<string, number>()
    for (const edge of recipe.productionPath.edges) {
      if (!selectedKinds.has(edge.kind)) continue
      const key = `${edge.kind}\u001f${edge.key}`
      edgeMultiplicity.set(key, (edgeMultiplicity.get(key) ?? 0) + 1)
    }
    const edgeSignature = JSON.stringify(
      [...edgeMultiplicity.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    )
    const key = JSON.stringify([
      [...recipe.eligibleCustomerIds].sort(),
      recipe.juiceUnitIngredientCost,
      edgeSignature,
    ])
    if (!representativeByKey.has(key)) {
      representativeByKey.set(key, recipe)
    }
  }

  const recipes = [...representativeByKey.values()]
  return recipes.length < domain.recipes.length
    ? { ...domain, recipes }
    : domain
}

"""
if marker not in source:
    raise SystemExit('diagnosis interface marker not found')
source = source.replace(marker, helper + marker, 1)

old_partition_type = """    partitions: Array<{
      kinds: ProductionStepKind[]
      lowerBound: number
    }>
    recipeKindsOptimum?: number"""
new_partition_type = """    partitions: Array<{
      kinds: ProductionStepKind[]
      lowerBound: number
      recipeCount?: number
    }>
    recipeKindsOptimum?: number"""
if old_partition_type not in source:
    raise SystemExit('combined partition type not found')
source = source.replace(old_partition_type, new_partition_type, 1)

old_direct_type = """  const directResults: Array<{
    kinds: ProductionStepKind[]
    lowerBound: number
    candidate: RecipeUnitSelection[]
  }> = []"""
new_direct_type = """  const directResults: Array<{
    kinds: ProductionStepKind[]
    lowerBound: number
    recipeCount: number
    candidate: RecipeUnitSelection[]
  }> = []"""
if old_direct_type not in source:
    raise SystemExit('direct results type not found')
source = source.replace(old_direct_type, new_direct_type, 1)

old_loop = """  for (const kinds of directPartitions) {
    const built = buildHighsStage(
      domain,
      'machineOperations',
      fixes,
      {
        relaxAssignmentVariables: true,
        aggregateEquivalentMaximumCostAssignments: true,
        tightenRecipeBoundsFromMinimumCostFix: true,
        tightenOperationBoundsFromRecipeBounds: true,
        machineOperationKinds: new Set(kinds),
      },
    )
    const solution = await built.model.solve()
    if (solution.status !== 'optimal') {
      directResults.length = 0
      break
    }

    directResults.push({
      kinds,
      lowerBound: Math.round(
        requiredFiniteNumber(
          solution.objective,
          `diagnosis direct ${kinds.join('+')} lower-bound objective`,
        ),
      ),
      candidate: selectedRecipeUnits(domain, built, solution),
    })
  }"""
new_loop = """  for (const kinds of directPartitions) {
    // For through-blending only, quotient recipes that are identical for
    // every expression active in this lower-bound stage: service set,
    // assignment/production cost coefficient, and selected operation-edge
    // multiplicities. Exact minimum production leaves at most one unused
    // serving globally, so a whole equivalence class can be consolidated
    // onto one real representative without exceeding that service set's
    // per-recipe capacity bound. The final fixed-x solve still uses `domain`.
    const partitionDomain =
      reducePostMaximumIngredientCostMachinePartitionForDiagnosis(
        domain,
        kinds,
        productionUnits,
      )
    const built = buildHighsStage(
      partitionDomain,
      'machineOperations',
      fixes,
      {
        relaxAssignmentVariables: true,
        aggregateEquivalentMaximumCostAssignments: true,
        tightenRecipeBoundsFromMinimumCostFix: true,
        tightenOperationBoundsFromRecipeBounds: true,
        machineOperationKinds: new Set(kinds),
      },
    )
    const solution = await built.model.solve()
    if (solution.status !== 'optimal') {
      directResults.length = 0
      break
    }

    directResults.push({
      kinds,
      lowerBound: Math.round(
        requiredFiniteNumber(
          solution.objective,
          `diagnosis direct ${kinds.join('+')} lower-bound objective`,
        ),
      ),
      recipeCount: partitionDomain.recipes.length,
      candidate: selectedRecipeUnits(
        partitionDomain,
        built,
        solution,
      ),
    })
  }"""
if old_loop not in source:
    raise SystemExit('direct partition loop not found')
source = source.replace(old_loop, new_loop, 1)

old_return_partition = """          partitions: directResults.map((result) => ({
            kinds: result.kinds,
            lowerBound: result.lowerBound,
          })),"""
new_return_partition = """          partitions: directResults.map((result) => ({
            kinds: result.kinds,
            lowerBound: result.lowerBound,
            recipeCount: result.recipeCount,
          })),"""
if old_return_partition not in source:
    raise SystemExit('direct return partitions not found')
source = source.replace(old_return_partition, new_return_partition, 1)

path.write_text(source)
