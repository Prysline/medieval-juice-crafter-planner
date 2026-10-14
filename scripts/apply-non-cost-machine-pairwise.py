from pathlib import Path

solver_path = Path('src/domain/optimizerHighsSolver.ts')
source = solver_path.read_text()
old_interface = """export interface PostMaximumIngredientCostMachineCertificateDiagnosis {
  prefix: {
    productionUnits: number
    assignedIngredientCost: number
    productionCost: number
  }
  certificate: MachineOperationCertificateSummary | null
}"""
new_interface = """export interface PostMaximumIngredientCostMachineCertificateDiagnosis {
  prefix: {
    productionUnits: number
    assignedIngredientCost: number
    productionCost: number
  }
  certificate: MachineOperationCertificateSummary | null
  combinedCertificate?: {
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
if old_interface not in source:
    raise SystemExit('diagnosis interface block not found')
source = source.replace(old_interface, new_interface, 1)

old_tail = """  return { prefix, certificate: null }
}

export interface JarSwitchCertificateSummary {"""
new_tail = """  const pairwiseSchemes: Array<{
    combinedKinds: ProductionStepKind[]
    remainingKinds: ProductionStepKind[]
    remainingLowerBound: number
    remainingCandidate: RecipeUnitSelection[]
  }> = [
    {
      combinedKinds: ['juicing', 'seasoning', 'blending'],
      remainingKinds: ['finalizing'],
      remainingLowerBound: lowerBounds.finalizing,
      remainingCandidate: witnessCandidates[2],
    },
    {
      combinedKinds: ['juicing', 'seasoning', 'finalizing'],
      remainingKinds: ['blending'],
      remainingLowerBound: lowerBounds.blending,
      remainingCandidate: witnessCandidates[1],
    },
    {
      combinedKinds: ['blending', 'finalizing'],
      remainingKinds: ['juicing', 'seasoning'],
      remainingLowerBound: lowerBounds.throughSeasoning,
      remainingCandidate: witnessCandidates[0],
    },
  ]

  for (const scheme of pairwiseSchemes) {
    const combinedBuilt = buildHighsStage(
      domain,
      'machineOperations',
      fixes,
      {
        relaxAssignmentVariables: true,
        aggregateEquivalentMaximumCostAssignments: true,
        tightenRecipeBoundsFromMinimumCostFix: true,
        tightenOperationBoundsFromRecipeBounds: true,
        machineOperationKinds: new Set(scheme.combinedKinds),
      },
    )
    const combinedSolution = await combinedBuilt.model.solve()
    if (combinedSolution.status !== 'optimal') continue

    const combinedLowerBound = Math.round(
      requiredFiniteNumber(
        combinedSolution.objective,
        `diagnosis ${scheme.combinedKinds.join('+')} lower-bound objective`,
      ),
    )
    const combinedCandidate = selectedRecipeUnits(
      domain,
      combinedBuilt,
      combinedSolution,
    )
    const schemeLowerBound =
      combinedLowerBound + scheme.remainingLowerBound

    for (const candidate of [
      combinedCandidate,
      scheme.remainingCandidate,
    ]) {
      const repaired = repairMachineOperationWitness(
        domain,
        candidate,
        productionCost,
        schemeLowerBound,
      )
      if (repaired.breakdown.total !== schemeLowerBound) continue

      const fixedRecipeUnits = new Map(
        repaired.selections.map((selection) => [
          selection.recipeId,
          selection.units,
        ]),
      )
      const built = buildHighsStage(
        domain,
        'machineOperations',
        fixes,
        { fixedRecipeUnits },
      )
      const solution = await built.model.solve()
      if (solution.status !== 'optimal') continue

      const verifiedObjective = Math.round(
        requiredFiniteNumber(
          solution.objective,
          'diagnosis pairwise fixed-x machine objective',
        ),
      )
      const assignmentCount = verifiedAssignmentCount(
        domain,
        built,
        solution,
      )
      if (
        verifiedObjective !== schemeLowerBound ||
        assignmentCount !== domain.serviceableCustomerIds.length
      ) {
        continue
      }

      return {
        prefix,
        certificate: null,
        combinedCertificate: {
          optimum: schemeLowerBound,
          partitions: [
            {
              kinds: scheme.combinedKinds,
              lowerBound: combinedLowerBound,
            },
            {
              kinds: scheme.remainingKinds,
              lowerBound: scheme.remainingLowerBound,
            },
          ],
          witnessRecipeUnits: repaired.selections,
          witnessRepairSteps: repaired.steps.length,
          verifiedAssignmentCount: assignmentCount,
        },
      }
    }
  }

  return { prefix, certificate: null, combinedCertificate: null }
}

export interface JarSwitchCertificateSummary {"""
if old_tail not in source:
    raise SystemExit('diagnosis tail marker not found')
source = source.replace(old_tail, new_tail, 1)
solver_path.write_text(source)

test_path = Path('src/domain/optimizerPostMaximumCostMachineCertificateProfile.test.ts')
test = test_path.read_text()
old_expect = """        if (expected) {
          expect(diagnosis!.prefix).toEqual(expected.prefix)
          expect(diagnosis!.certificate).not.toBeNull()
          expect(diagnosis!.certificate!.optimum).toBe(
            expected.machineOperations,
          )
        }
        if (diagnosis?.certificate) {
          expect(
            diagnosis.certificate.verifiedAssignmentCount,
          ).toBe(domain.serviceableCustomerIds.length)
        }"""
new_expect = """        const exactCertificate =
          diagnosis?.certificate ?? diagnosis?.combinedCertificate ?? null
        if (expected) {
          expect(diagnosis!.prefix).toEqual(expected.prefix)
          expect(exactCertificate).not.toBeNull()
          expect(exactCertificate!.optimum).toBe(
            expected.machineOperations,
          )
        }
        if (exactCertificate) {
          expect(exactCertificate.verifiedAssignmentCount).toBe(
            domain.serviceableCustomerIds.length,
          )
        }"""
if old_expect not in test:
    raise SystemExit('diagnosis expectation block not found')
test_path.write_text(test.replace(old_expect, new_expect, 1))
