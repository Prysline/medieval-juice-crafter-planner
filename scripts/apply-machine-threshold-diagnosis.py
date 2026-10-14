from pathlib import Path

solver_path = Path('src/domain/optimizerHighsSolver.ts')
source = solver_path.read_text()

source = source.replace(
"""  machineOperationActiveEdgeLowerBound?: boolean
  machineOperationKinds?: Set<ProductionStepKind>
  fixedRecipeUnits?: Map<string, number>""",
"""  machineOperationActiveEdgeLowerBound?: boolean
  machineOperationKinds?: Set<ProductionStepKind>
  machineOperationsUpperBound?: number
  fixedRecipeUnits?: Map<string, number>""",
1,
)
source = source.replace(
"""  const needsProductionOperations =
    needsAnyObjective('machineOperations', 'jarFillOperations') ||
    hasJarFillHardConstraint""",
"""  const hasMachineOperationsUpperBound =
    typeof options.machineOperationsUpperBound === 'number' &&
    Number.isFinite(options.machineOperationsUpperBound)
  const needsProductionOperations =
    needsAnyObjective('machineOperations', 'jarFillOperations') ||
    hasJarFillHardConstraint ||
    hasMachineOperationsUpperBound""",
1,
)
source = source.replace(
"""  const machineOperationsExpression = needsAnyObjective('machineOperations')
    ? sum(...operationByEdgeKey.values())
    : undefined

  const jarFillOperationsExpression =""",
"""  const machineOperationsExpression =
    needsAnyObjective('machineOperations') || hasMachineOperationsUpperBound
      ? sum(...operationByEdgeKey.values())
      : undefined

  if (machineOperationsExpression && hasMachineOperationsUpperBound) {
    model.addConstraint(
      machineOperationsExpression.leq(
        Math.max(0, Math.floor(options.machineOperationsUpperBound!)),
      ),
      'machine_operations_hard_limit',
    )
  }

  const jarFillOperationsExpression =""",
1,
)

marker = """export interface JarSwitchCertificateSummary {"""
if marker not in source:
    raise SystemExit('jar switch marker not found')
threshold_function = r'''
/**
 * Diagnosis-only alternative to the direct front3 optimization above.
 * It starts from disjoint per-kind lower bounds, then asks a sequence of
 * exact feasibility questions at consecutive front3 operation caps. The
 * first feasible cap is therefore the exact front3 optimum. This remains
 * diagnosis-only until it is both faster and covered by production regressions.
 */
export async function solvePostMaximumIngredientCostMachineThresholdCertificateForDiagnosis(
  domain: BatchOptimizationModel,
): Promise<PostMaximumIngredientCostMachineCertificateDiagnosis | null> {
  if (!maximumIngredientCostGroupedProductionIsSafe(domain)) return null
  if (
    domain.recipes.some(
      (recipe) => (recipe.initialFinishedServings ?? 0) > 0,
    )
  ) {
    return null
  }

  const fixes: ObjectiveFix[] = []
  const minimumWasteBuilt = buildHighsStage(
    domain,
    'productionUnits',
    [],
    { aggregateEquivalentAssignments: true },
  )
  const minimumWasteSolution = await minimumWasteBuilt.model.solve()
  if (minimumWasteSolution.status !== 'optimal') return null
  const productionUnits = Math.round(
    requiredFiniteNumber(
      minimumWasteSolution.objective,
      'threshold diagnosis minimum-waste objective',
    ),
  )
  fixes.push({ objective: 'productionUnits', value: productionUnits })

  const maximumIngredientCostBuilt = buildHighsStage(
    domain,
    'negativeAssignedIngredientCost',
    fixes,
    {
      aggregateEquivalentMaximumCostAssignments: true,
      aggregateEquivalentMaximumCostProductionUnits: true,
    },
  )
  const maximumIngredientCostSolution =
    await maximumIngredientCostBuilt.model.solve()
  if (maximumIngredientCostSolution.status !== 'optimal') return null
  const negativeAssignedIngredientCost = Math.round(
    requiredFiniteNumber(
      maximumIngredientCostSolution.objective,
      'threshold diagnosis maximum-ingredient-cost objective',
    ),
  )
  fixes.push({
    objective: 'negativeAssignedIngredientCost',
    value: negativeAssignedIngredientCost,
  })

  const productionCost =
    await tryPostMaximumIngredientCostPairParityOptimum(domain, fixes)
  if (productionCost === null) return null
  fixes.push({ objective: 'cost', value: productionCost })

  const prefix = {
    productionUnits,
    assignedIngredientCost: -negativeAssignedIngredientCost,
    productionCost,
  }
  const partitionDefinitions: Array<{
    key: ProductionStepKind
    kinds: ProductionStepKind[]
    activeEdgeLowerBound?: boolean
  }> = [
    { key: 'juicing', kinds: ['juicing'] },
    {
      key: 'seasoning',
      kinds: ['seasoning'],
      activeEdgeLowerBound: true,
    },
    { key: 'blending', kinds: ['blending'] },
    { key: 'finalizing', kinds: ['finalizing'] },
  ]
  const lowerBounds: Record<ProductionStepKind, number> = {
    juicing: 0,
    seasoning: 0,
    blending: 0,
    finalizing: 0,
  }
  const witnessCandidates: RecipeUnitSelection[][] = []

  for (const partition of partitionDefinitions) {
    const built = buildHighsStage(
      domain,
      'machineOperations',
      fixes,
      {
        relaxAssignmentVariables: true,
        aggregateEquivalentMaximumCostAssignments: true,
        tightenRecipeBoundsFromMinimumCostFix: true,
        tightenOperationBoundsFromRecipeBounds: true,
        machineOperationActiveEdgeLowerBound:
          partition.activeEdgeLowerBound,
        machineOperationKinds: new Set(partition.kinds),
      },
    )
    const solution = await built.model.solve()
    if (solution.status !== 'optimal') {
      return { prefix, certificate: null, combinedCertificate: null }
    }
    lowerBounds[partition.key] = Math.round(
      requiredFiniteNumber(
        solution.objective,
        `threshold diagnosis ${partition.key} lower-bound objective`,
      ),
    )
    witnessCandidates.push(selectedRecipeUnits(domain, built, solution))
  }

  const frontKinds: ProductionStepKind[] = [
    'juicing',
    'seasoning',
    'blending',
  ]
  const initialFrontLowerBound =
    lowerBounds.juicing + lowerBounds.seasoning + lowerBounds.blending
  const finalizingLowerBound = lowerBounds.finalizing
  const maxThresholdGap = 4

  for (
    let frontCap = initialFrontLowerBound;
    frontCap <= initialFrontLowerBound + maxThresholdGap;
    frontCap += 1
  ) {
    const built = buildHighsStage(
      domain,
      'productionUnits',
      fixes,
      {
        relaxAssignmentVariables: true,
        aggregateEquivalentMaximumCostAssignments: true,
        tightenRecipeBoundsFromMinimumCostFix: true,
        tightenOperationBoundsFromRecipeBounds: true,
        machineOperationKinds: new Set(frontKinds),
        machineOperationsUpperBound: frontCap,
      },
    )
    const solution = await built.model.solve()
    if (solution.status === 'infeasible') continue
    if (solution.status !== 'optimal') {
      return { prefix, certificate: null, combinedCertificate: null }
    }

    const totalLowerBound = frontCap + finalizingLowerBound
    const candidates = [
      selectedRecipeUnits(domain, built, solution),
      ...witnessCandidates,
    ]
    for (const candidate of candidates) {
      const repaired = repairMachineOperationWitness(
        domain,
        candidate,
        productionCost,
        totalLowerBound,
      )
      if (repaired.breakdown.total !== totalLowerBound) continue

      const fixedRecipeUnits = new Map(
        repaired.selections.map((selection) => [
          selection.recipeId,
          selection.units,
        ]),
      )
      const verificationBuilt = buildHighsStage(
        domain,
        'machineOperations',
        fixes,
        { fixedRecipeUnits },
      )
      const verificationSolution = await verificationBuilt.model.solve()
      if (verificationSolution.status !== 'optimal') continue
      const verifiedObjective = Math.round(
        requiredFiniteNumber(
          verificationSolution.objective,
          'threshold diagnosis fixed-x machine objective',
        ),
      )
      const assignmentCount = verifiedAssignmentCount(
        domain,
        verificationBuilt,
        verificationSolution,
      )
      if (
        verifiedObjective !== totalLowerBound ||
        assignmentCount !== domain.serviceableCustomerIds.length
      ) {
        continue
      }

      const positiveWitnessRecipeUnits = repaired.selections.filter(
        (selection) => selection.units > 0,
      )
      const witnessProductionUnits = positiveWitnessRecipeUnits.reduce(
        (total, selection) => total + Math.round(selection.units),
        0,
      )
      const recipeKindsLowerBound =
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

      return {
        prefix,
        certificate: null,
        combinedCertificate: {
          optimum: totalLowerBound,
          partitions: [
            { kinds: frontKinds, lowerBound: frontCap },
            {
              kinds: ['finalizing'],
              lowerBound: finalizingLowerBound,
            },
          ],
          ...(recipeKindsOptimum === undefined
            ? {}
            : { recipeKindsOptimum }),
          witnessRecipeUnits: repaired.selections,
          witnessRepairSteps: repaired.steps.length,
          verifiedAssignmentCount: assignmentCount,
        },
      }
    }

    // The first feasible cap proves the front3 optimum. If no witness can be
    // repaired and verified at that value, do not skip to a higher cap and
    // accidentally weaken lexicographic exactness.
    return { prefix, certificate: null, combinedCertificate: null }
  }

  return { prefix, certificate: null, combinedCertificate: null }
}

'''
source = source.replace(marker, threshold_function + marker, 1)
solver_path.write_text(source)

test_path = Path('src/domain/optimizerPostMaximumCostMachineCertificateProfile.test.ts')
test = test_path.read_text()
test = test.replace(
"""import {
  solvePostMaximumIngredientCostMachineCertificateForDiagnosis,
} from './optimizerHighsSolver'""",
"""import {
  solvePostMaximumIngredientCostMachineCertificateForDiagnosis,
  solvePostMaximumIngredientCostMachineThresholdCertificateForDiagnosis,
} from './optimizerHighsSolver'""",
1,
)
test = test.replace(
"""const enabled =
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_CERTIFICATE_PROFILE === '1'
const requestedCustomerCount = Number(""",
"""const thresholdEnabled =
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_THRESHOLD_PROFILE === '1'
const enabled =
  thresholdEnabled ||
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_CERTIFICATE_PROFILE === '1'
const requestedCustomerCount = Number(""",
1,
)
test = test.replace(
"""          diagnosis =
            await solvePostMaximumIngredientCostMachineCertificateForDiagnosis(
              domain,
            )""",
"""          diagnosis = thresholdEnabled
            ? await solvePostMaximumIngredientCostMachineThresholdCertificateForDiagnosis(
                domain,
              )
            : await solvePostMaximumIngredientCostMachineCertificateForDiagnosis(
                domain,
              )""",
1,
)
test = test.replace(
"""            requestedCustomers: requestedCustomerCount,
            dimensions: dimensions(domain),""",
"""            mode: thresholdEnabled ? 'threshold' : 'direct',
            requestedCustomers: requestedCustomerCount,
            dimensions: dimensions(domain),""",
1,
)
test = test.replace(
"""          expect(events).toHaveLength(expected.solveCount)
        }""",
"""          if (!thresholdEnabled) {
            expect(events).toHaveLength(expected.solveCount)
          }
        }""",
1,
)
test_path.write_text(test)
