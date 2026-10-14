from pathlib import Path

solver_path = Path('src/domain/optimizerHighsSolver.ts')
source = solver_path.read_text()
source = source.replace(
"""  machineOperationActiveEdgeLowerBound?: boolean
  machineOperationKinds?: Set<ProductionStepKind>
  fixedRecipeUnits?: Map<string, number>""",
"""  machineOperationActiveEdgeLowerBound?: boolean
  machineOperationKinds?: Set<ProductionStepKind>
  machineOperationGroupUpperBounds?: Array<{
    kinds: Set<ProductionStepKind>
    value: number
  }>
  fixedRecipeUnits?: Map<string, number>""",
1,
)
source = source.replace(
"""  const needsProductionOperations =
    needsAnyObjective('machineOperations', 'jarFillOperations') ||
    hasJarFillHardConstraint""",
"""  const hasMachineOperationGroupUpperBounds =
    (options.machineOperationGroupUpperBounds?.length ?? 0) > 0
  const needsProductionOperations =
    needsAnyObjective('machineOperations', 'jarFillOperations') ||
    hasJarFillHardConstraint ||
    hasMachineOperationGroupUpperBounds""",
1,
)
needle = """  const machineOperationsExpression = needsAnyObjective('machineOperations')
    ? sum(...operationByEdgeKey.values())
    : undefined

  const jarFillOperationsExpression ="""
replacement = """  const machineOperationsExpression = needsAnyObjective('machineOperations')
    ? sum(...operationByEdgeKey.values())
    : undefined

  options.machineOperationGroupUpperBounds?.forEach(
    (group, groupIndex) => {
      const groupExpression = sum(
        ...[...operationByEdgeKey.entries()].flatMap(
          ([edgeKey, operation]) =>
            group.kinds.has(operationKindByEdgeKey.get(edgeKey)!)
              ? [operation]
              : [],
        ),
      )
      model.addConstraint(
        groupExpression.leq(Math.max(0, Math.floor(group.value))),
        `machine_operation_group_limit_${groupIndex}`,
      )
    },
  )

  const jarFillOperationsExpression ="""
if needle not in source:
    raise SystemExit('machine operation expression marker not found')
source = source.replace(needle, replacement, 1)

marker = """export interface JarSwitchCertificateSummary {"""
if marker not in source:
    raise SystemExit('jar switch marker not found')
helper = r'''
/**
 * Diagnosis-only front3 coupling proof using two operation boxes instead of
 * one summed operation threshold. Disjoint single-kind lower bounds establish
 * T = juicing+seasoning and B = blending floors. Boundary boxes are then
 * tested in increasing T+B order; the first feasible boundary proves the
 * exact front3 optimum. Full original-domain fixed-x verification remains
 * mandatory before any machine/recipe-kind certificate is returned.
 */
export async function solvePostMaximumIngredientCostMachineKindBoxCertificateForDiagnosis(
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
      'kind-box diagnosis minimum-waste objective',
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
      'kind-box diagnosis maximum-ingredient-cost objective',
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
  const partitionCandidates: RecipeUnitSelection[][] = []

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
        `kind-box diagnosis ${partition.key} lower-bound objective`,
      ),
    )
    partitionCandidates.push(selectedRecipeUnits(domain, built, solution))
  }

  const throughKinds = new Set<ProductionStepKind>([
    'juicing',
    'seasoning',
  ])
  const blendingKinds = new Set<ProductionStepKind>(['blending'])
  const frontKinds = new Set<ProductionStepKind>([
    'juicing',
    'seasoning',
    'blending',
  ])
  const throughLowerBound = lowerBounds.juicing + lowerBounds.seasoning
  const blendingLowerBound = lowerBounds.blending
  const finalizingLowerBound = lowerBounds.finalizing
  const maxExtraOperations = 4

  for (let totalExtra = 0; totalExtra <= maxExtraOperations; totalExtra += 1) {
    let feasible:
      | {
          throughCap: number
          blendingCap: number
          candidate: RecipeUnitSelection[]
        }
      | null = null

    for (let throughExtra = 0; throughExtra <= totalExtra; throughExtra += 1) {
      const blendingExtra = totalExtra - throughExtra
      const throughCap = throughLowerBound + throughExtra
      const blendingCap = blendingLowerBound + blendingExtra
      const built = buildHighsStage(
        domain,
        'productionUnits',
        fixes,
        {
          relaxAssignmentVariables: true,
          aggregateEquivalentMaximumCostAssignments: true,
          tightenRecipeBoundsFromMinimumCostFix: true,
          tightenOperationBoundsFromRecipeBounds: true,
          machineOperationKinds: frontKinds,
          machineOperationGroupUpperBounds: [
            { kinds: throughKinds, value: throughCap },
            { kinds: blendingKinds, value: blendingCap },
          ],
        },
      )
      const solution = await built.model.solve()
      if (solution.status === 'infeasible') continue
      if (solution.status !== 'optimal') {
        return { prefix, certificate: null, combinedCertificate: null }
      }
      feasible = {
        throughCap,
        blendingCap,
        candidate: selectedRecipeUnits(domain, built, solution),
      }
      break
    }

    if (!feasible) continue

    const frontLowerBound =
      feasible.throughCap + feasible.blendingCap
    const totalLowerBound = frontLowerBound + finalizingLowerBound
    for (const candidate of [feasible.candidate, ...partitionCandidates]) {
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
          'kind-box diagnosis fixed-x machine objective',
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
            {
              kinds: ['juicing', 'seasoning', 'blending'],
              lowerBound: frontLowerBound,
            },
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

    // A feasible boundary proves the exact front3 optimum at this total.
    // If it cannot be extended to a full machine witness meeting the
    // independent finalizing lower bound, the decomposed certificate does
    // not close; do not move to a weaker higher total.
    return { prefix, certificate: null, combinedCertificate: null }
  }

  return { prefix, certificate: null, combinedCertificate: null }
}

'''
source = source.replace(marker, helper + marker, 1)
solver_path.write_text(source)

test_path = Path('src/domain/optimizerPostMaximumCostMachineCertificateProfile.test.ts')
test = test_path.read_text()
test = test.replace(
"""import {
  solvePostMaximumIngredientCostMachineCertificateForDiagnosis,
} from './optimizerHighsSolver'""",
"""import {
  solvePostMaximumIngredientCostMachineCertificateForDiagnosis,
  solvePostMaximumIngredientCostMachineKindBoxCertificateForDiagnosis,
} from './optimizerHighsSolver'""",
1,
)
test = test.replace(
"""const enabled =
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_CERTIFICATE_PROFILE === '1'
const requestedCustomerCount = Number(""",
"""const kindBoxEnabled =
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_KIND_BOX_PROFILE === '1'
const enabled =
  kindBoxEnabled ||
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_CERTIFICATE_PROFILE === '1'
const requestedCustomerCount = Number(""",
1,
)
test = test.replace(
"""          diagnosis =
            await solvePostMaximumIngredientCostMachineCertificateForDiagnosis(
              domain,
            )""",
"""          diagnosis = kindBoxEnabled
            ? await solvePostMaximumIngredientCostMachineKindBoxCertificateForDiagnosis(
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
"""            mode: kindBoxEnabled ? 'kind-box' : 'direct',
            requestedCustomers: requestedCustomerCount,
            dimensions: dimensions(domain),""",
1,
)
test = test.replace(
"""          expect(events).toHaveLength(expected.solveCount)
        }""",
"""          if (!kindBoxEnabled) {
            expect(events).toHaveLength(expected.solveCount)
          }
        }""",
1,
)
test_path.write_text(test)
