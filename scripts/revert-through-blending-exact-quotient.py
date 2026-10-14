from pathlib import Path

path = Path('src/domain/optimizerHighsSolver.ts')
source = path.read_text()

helper_start = source.find('function reducePostMaximumIngredientCostMachinePartitionForDiagnosis(')
interface_start = source.find('export interface PostMaximumIngredientCostMachineCertificateDiagnosis {')
if helper_start < 0 or interface_start < 0 or helper_start >= interface_start:
    raise SystemExit('quotient helper block not found')
source = source[:helper_start] + source[interface_start:]

source = source.replace(
"""    partitions: Array<{
      kinds: ProductionStepKind[]
      lowerBound: number
      recipeCount?: number
    }>""",
"""    partitions: Array<{
      kinds: ProductionStepKind[]
      lowerBound: number
    }>""",
1,
)
source = source.replace(
"""  const directResults: Array<{
    kinds: ProductionStepKind[]
    lowerBound: number
    recipeCount: number
    candidate: RecipeUnitSelection[]
  }> = []""",
"""  const directResults: Array<{
    kinds: ProductionStepKind[]
    lowerBound: number
    candidate: RecipeUnitSelection[]
  }> = []""",
1,
)
old_loop = """  for (const kinds of directPartitions) {
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
new_loop = """  for (const kinds of directPartitions) {
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
if old_loop not in source:
    raise SystemExit('quotient direct loop not found')
source = source.replace(old_loop, new_loop, 1)
source = source.replace(
"""          partitions: directResults.map((result) => ({
            kinds: result.kinds,
            lowerBound: result.lowerBound,
            recipeCount: result.recipeCount,
          })),""",
"""          partitions: directResults.map((result) => ({
            kinds: result.kinds,
            lowerBound: result.lowerBound,
          })),""",
1,
)
path.write_text(source)
