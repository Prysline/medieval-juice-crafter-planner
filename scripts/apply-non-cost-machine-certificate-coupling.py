from pathlib import Path

path = Path('src/domain/optimizerHighsSolver.ts')
source = path.read_text()
old = """  const partitions: Array<{
    key: keyof MachineOperationCertificateSummary['lowerBounds']
    kinds: ProductionStepKind[]
    activeEdgeLowerBound?: boolean
  }> = [
    { key: 'throughSeasoning', kinds: ['juicing'] },
    {
      key: 'throughSeasoning',
      kinds: ['seasoning'],
      activeEdgeLowerBound: true,
    },
    { key: 'blending', kinds: ['blending'] },
    { key: 'finalizing', kinds: ['finalizing'] },
  ]"""
new = """  const partitions: Array<{
    key: keyof MachineOperationCertificateSummary['lowerBounds']
    kinds: ProductionStepKind[]
  }> = [
    {
      key: 'throughSeasoning',
      kinds: ['juicing', 'seasoning'],
    },
    { key: 'blending', kinds: ['blending'] },
    { key: 'finalizing', kinds: ['finalizing'] },
  ]"""
if old not in source:
    raise SystemExit('partition block not found')
source = source.replace(old, new, 1)
source = source.replace(
    'then asks whether four\n * independent full-domain machine-operation lower bounds can close',
    'then asks whether three\n * independent full-domain machine-operation lower bounds can close',
    1,
)
old_option = """        machineOperationActiveEdgeLowerBound:
          partition.activeEdgeLowerBound,
        machineOperationKinds: new Set(partition.kinds),"""
new_option = """        machineOperationKinds: new Set(partition.kinds),"""
if old_option not in source:
    raise SystemExit('active-edge option block not found')
source = source.replace(old_option, new_option, 1)
path.write_text(source)
