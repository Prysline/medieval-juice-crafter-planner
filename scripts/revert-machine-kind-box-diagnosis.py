from pathlib import Path

solver_path = Path('src/domain/optimizerHighsSolver.ts')
source = solver_path.read_text()

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing {label}')
    return text.replace(old, new, 1)

source = replace_once(
    source,
    """  machineOperationActiveEdgeLowerBound?: boolean
  machineOperationKinds?: Set<ProductionStepKind>
  machineOperationGroupUpperBounds?: Array<{
    kinds: Set<ProductionStepKind>
    value: number
  }>
  fixedRecipeUnits?: Map<string, number>""",
    """  machineOperationActiveEdgeLowerBound?: boolean
  machineOperationKinds?: Set<ProductionStepKind>
  fixedRecipeUnits?: Map<string, number>""",
    'machineOperationGroupUpperBounds option',
)
source = replace_once(
    source,
    """  const hasMachineOperationGroupUpperBounds =
    (options.machineOperationGroupUpperBounds?.length ?? 0) > 0
  const needsProductionOperations =
    needsAnyObjective('machineOperations', 'jarFillOperations') ||
    hasJarFillHardConstraint ||
    hasMachineOperationGroupUpperBounds""",
    """  const needsProductionOperations =
    needsAnyObjective('machineOperations', 'jarFillOperations') ||
    hasJarFillHardConstraint""",
    'group-bound production-operation gate',
)
source = replace_once(
    source,
    """  const machineOperationsExpression = needsAnyObjective('machineOperations')
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

  const jarFillOperationsExpression =""",
    """  const machineOperationsExpression = needsAnyObjective('machineOperations')
    ? sum(...operationByEdgeKey.values())
    : undefined

  const jarFillOperationsExpression =""",
    'group-bound hard constraints',
)
start = source.find('/**\n * Diagnosis-only front3 coupling proof using two operation boxes instead of')
end = source.find('export interface JarSwitchCertificateSummary {')
if start < 0 or end < 0 or start >= end:
    raise SystemExit('kind-box helper block not found')
source = source[:start] + source[end:]
solver_path.write_text(source)

test_path = Path('src/domain/optimizerPostMaximumCostMachineCertificateProfile.test.ts')
test = test_path.read_text()
test = replace_once(
    test,
    """import {
  solvePostMaximumIngredientCostMachineCertificateForDiagnosis,
  solvePostMaximumIngredientCostMachineKindBoxCertificateForDiagnosis,
} from './optimizerHighsSolver'""",
    """import {
  solvePostMaximumIngredientCostMachineCertificateForDiagnosis,
} from './optimizerHighsSolver'""",
    'kind-box test import',
)
test = replace_once(
    test,
    """const kindBoxEnabled =
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_KIND_BOX_PROFILE === '1'
const enabled =
  kindBoxEnabled ||
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_CERTIFICATE_PROFILE === '1'
const requestedCustomerCount = Number(""",
    """const enabled =
  process.env.OPTIMIZER_POST_MAX_COST_MACHINE_CERTIFICATE_PROFILE === '1'
const requestedCustomerCount = Number(""",
    'kind-box env gate',
)
test = replace_once(
    test,
    """          diagnosis = kindBoxEnabled
            ? await solvePostMaximumIngredientCostMachineKindBoxCertificateForDiagnosis(
                domain,
              )
            : await solvePostMaximumIngredientCostMachineCertificateForDiagnosis(
                domain,
              )""",
    """          diagnosis =
            await solvePostMaximumIngredientCostMachineCertificateForDiagnosis(
              domain,
            )""",
    'kind-box diagnosis dispatch',
)
test = replace_once(
    test,
    """            mode: kindBoxEnabled ? 'kind-box' : 'direct',
            requestedCustomers: requestedCustomerCount,
            dimensions: dimensions(domain),""",
    """            requestedCustomers: requestedCustomerCount,
            dimensions: dimensions(domain),""",
    'kind-box summary mode',
)
test = replace_once(
    test,
    """          if (!kindBoxEnabled) {
            expect(events).toHaveLength(expected.solveCount)
          }
        }""",
    """          expect(events).toHaveLength(expected.solveCount)
        }""",
    'kind-box solve-count exception',
)
test_path.write_text(test)

for path in [
    Path('.github/workflows/optimizer-non-cost-machine-kind-box-diagnosis.yml'),
    Path('scripts/revert-machine-kind-box-diagnosis.py'),
    Path('.github/workflows/revert-machine-kind-box-diagnosis.yml'),
]:
    if path.exists():
        path.unlink()
