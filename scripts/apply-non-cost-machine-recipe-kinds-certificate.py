from pathlib import Path

solver_path = Path('src/domain/optimizerHighsSolver.ts')
source = solver_path.read_text()

old_interface = """  combinedCertificate?: {
    optimum: number
    partitions: Array<{
      kinds: ProductionStepKind[]
      lowerBound: number
    }>
    witnessRecipeUnits: RecipeUnitSelection[]
    witnessRepairSteps: number
    verifiedAssignmentCount: number
  } | null
}"""
new_interface = """  combinedCertificate?: {
    optimum: number
    partitions: Array<{
      kinds: ProductionStepKind[]
      lowerBound: number
    }>
    recipeKindsOptimum?: number
    witnessRecipeUnits: RecipeUnitSelection[]
    witnessRepairSteps: number
    verifiedAssignmentCount: number
  } | null
}"""
if old_interface not in source:
    raise SystemExit('combined certificate interface not found')
source = source.replace(old_interface, new_interface, 1)

old_comment = """ * It replays the existing exact prefix stages, then asks whether three
 * independent full-domain machine-operation lower bounds can close
 * against a repaired witness. Every prior lexicographic optimum is
 * fixed during the lower-bound solves, and any candidate certificate
 * still requires a full original-domain fixed-x verification."""
new_comment = """ * It replays the existing exact prefix stages, then first asks whether a
 * through-blending + finalizing decomposition can close against a repaired
 * witness. Every prior lexicographic optimum is fixed during the lower-bound
 * solves, and any candidate certificate still requires a full original-domain
 * fixed-x verification. Historical finer partitions remain diagnosis fallback."""
if old_comment not in source:
    raise SystemExit('diagnosis comment block not found')
source = source.replace(old_comment, new_comment, 1)

old_return = """      return {
        prefix,
        certificate: null,
        combinedCertificate: {
          optimum: directLowerBound,
          partitions: directResults.map((result) => ({
            kinds: result.kinds,
            lowerBound: result.lowerBound,
          })),
          witnessRecipeUnits: repaired.selections,
          witnessRepairSteps: repaired.steps.length,
          verifiedAssignmentCount: assignmentCount,
        },
      }"""
new_return = """      const positiveWitnessRecipeUnits = repaired.selections.filter(
        (selection) => selection.units > 0,
      )
      const witnessProductionUnits = positiveWitnessRecipeUnits.reduce(
        (total, selection) => total + Math.round(selection.units),
        0,
      )
      const finalizingLowerBound = directResults.find(
        (result) =>
          result.kinds.length === 1 &&
          result.kinds[0] === 'finalizing',
      )?.lowerBound
      const recipeKindsLowerBound =
        finalizingLowerBound !== undefined &&
        finalizingEdgesAreRecipeIdentityUnique(domain) &&
        witnessProductionUnits === productionUnits
          ? minimumRecipeKindsFromFinalizingBound(
              productionUnits,
              finalizingLowerBound,
            )
          : null
      const recipeKindsOptimum =
        recipeKindsLowerBound !== null &&
        positiveWitnessRecipeUnits.length === recipeKindsLowerBound
          ? recipeKindsLowerBound
          : undefined

      // Because the exact machine optimum equals the sum of two disjoint
      // partition lower bounds, every machine-optimal solution must attain
      // the finalizing lower bound exactly. With one identity-unique
      // finalizing edge per recipe, the stack-capacity formula is therefore
      // a recipe-kind lower bound at this exact prefix. Matching it with the
      // already verified machine-optimal witness closes recipe kinds without
      // another MIP solve.
      return {
        prefix,
        certificate: null,
        combinedCertificate: {
          optimum: directLowerBound,
          partitions: directResults.map((result) => ({
            kinds: result.kinds,
            lowerBound: result.lowerBound,
          })),
          ...(recipeKindsOptimum === undefined
            ? {}
            : { recipeKindsOptimum }),
          witnessRecipeUnits: repaired.selections,
          witnessRepairSteps: repaired.steps.length,
          verifiedAssignmentCount: assignmentCount,
        },
      }"""
if old_return not in source:
    raise SystemExit('direct certificate return block not found')
source = source.replace(old_return, new_return, 1)
solver_path.write_text(source)

test_path = Path('src/domain/optimizerPostMaximumCostMachineCertificateProfile.test.ts')
test = test_path.read_text()
test = test.replace(
"""      machineOperations: 24,
    },""",
"""      machineOperations: 24,
      recipeKinds: 6,
      solveCount: 6,
    },""",
1,
)
test = test.replace(
"""      machineOperations: 55,
    },""",
"""      machineOperations: 55,
      recipeKinds: 15,
      solveCount: 6,
    },""",
1,
)
old_assert = """          expect(exactCertificate!.optimum).toBe(
            expected.machineOperations,
          )
        }
        if (exactCertificate) {"""
new_assert = """          expect(exactCertificate!.optimum).toBe(
            expected.machineOperations,
          )
          expect(diagnosis!.combinedCertificate?.recipeKindsOptimum).toBe(
            expected.recipeKinds,
          )
          expect(events).toHaveLength(expected.solveCount)
        }
        if (exactCertificate) {"""
if old_assert not in test:
    raise SystemExit('profile assertion block not found')
test = test.replace(old_assert, new_assert, 1)
test_path.write_text(test)
