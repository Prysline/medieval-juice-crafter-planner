from pathlib import Path

solver_path = Path('src/domain/optimizerHighsSolver.ts')
source = solver_path.read_text()
source = source.replace(
"""  machineOperationActiveEdgeLowerBound?: boolean
  machineOperationKinds?: Set<ProductionStepKind>
  machineOperationsUpperBound?: number
  fixedRecipeUnits?: Map<string, number>""",
"""  machineOperationActiveEdgeLowerBound?: boolean
  machineOperationKinds?: Set<ProductionStepKind>
  fixedRecipeUnits?: Map<string, number>""",
1,
)
source = source.replace(
"""  const hasMachineOperationsUpperBound =
    typeof options.machineOperationsUpperBound === 'number' &&
    Number.isFinite(options.machineOperationsUpperBound)
  const needsProductionOperations =
    needsAnyObjective('machineOperations', 'jarFillOperations') ||
    hasJarFillHardConstraint ||
    hasMachineOperationsUpperBound""",
"""  const needsProductionOperations =
    needsAnyObjective('machineOperations', 'jarFillOperations') ||
    hasJarFillHardConstraint""",
1,
)
source = source.replace(
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
"""  const machineOperationsExpression = needsAnyObjective('machineOperations')
    ? sum(...operationByEdgeKey.values())
    : undefined

  const jarFillOperationsExpression =""",
1,
)
start = source.find('/**\n * Diagnosis-only alternative to the direct front3 optimization above.')
end = source.find('export interface JarSwitchCertificateSummary {')
if start < 0 or end < 0 or start >= end:
    raise SystemExit('threshold helper block not found')
source = source[:start] + source[end:]
solver_path.write_text(source)

test_path = Path('src/domain/optimizerPostMaximumCostMachineCertificateProfile.test.ts')
test = test_path.read_text()
test = test.replace(
"""import {
  solvePostMaximumIngredientCostMachineCertificateForDiagnosis,
  solvePostMaximumIngredientCostMachineThresholdCertificateForDiagnosis,
} from './optimizerHighsSolver'""",
"""import {
  solvePostMaximumIngredientCostMachineCertificateForDiagnosis,
} from './optimizerHighsSolver'""",
1,
)
test = test.replace(
"""const thresholdEnabled =
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_THRESHOLD_PROFILE === '1'
const enabled =
  thresholdEnabled ||
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_CERTIFICATE_PROFILE === '1'""",
"""const enabled =
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_CERTIFICATE_PROFILE === '1'""",
1,
)
test = test.replace(
"""          diagnosis = thresholdEnabled
            ? await solvePostMaximumIngredientCostMachineThresholdCertificateForDiagnosis(
                domain,
              )
            : await solvePostMaximumIngredientCostMachineCertificateForDiagnosis(
                domain,
              )""",
"""          diagnosis =
            await solvePostMaximumIngredientCostMachineCertificateForDiagnosis(
              domain,
            )""",
1,
)
test = test.replace(
"""            mode: thresholdEnabled ? 'threshold' : 'direct',
            requestedCustomers: requestedCustomerCount,""",
"""            requestedCustomers: requestedCustomerCount,""",
1,
)
test = test.replace(
"""          if (!thresholdEnabled) {
            expect(events).toHaveLength(expected.solveCount)
          }""",
"""          expect(events).toHaveLength(expected.solveCount)""",
1,
)
test_path.write_text(test)
