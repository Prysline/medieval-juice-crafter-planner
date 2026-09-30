import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const optimizerToolsSource = readFileSync(
  new URL('./OptimizerTools.tsx', import.meta.url),
  'utf8',
)

describe('delivery checkbox and whole-plan application contract', () => {
  it('rebases delivery edits against the original supplied basis without discarding the last valid draft', () => {
    expect(optimizerToolsSource).toContain(
      'rebaseDeliveryTransactionDraft(',
    )
    expect(optimizerToolsSource).toContain(
      'current.deliveryExpectedBasis.suppliedCustomerIds',
    )
    expect(optimizerToolsSource).toContain(
      'transactionDraft: rebased ?? draft',
    )
    expect(optimizerToolsSource).toContain(
      'transactionDraft: rebasedTransaction.transactionDraft',
    )
    expect(optimizerToolsSource).toContain(
      'transactionDraftInvalidatedByPartialDelivery:\n          rebasedTransaction.invalidated',
    )
    expect(optimizerToolsSource).not.toContain(
      'transactionDraft: null,\n            transactionDraftInvalidatedByPartialDelivery: true',
    )
  })

  it('keeps stale optimizer success as session-only readonly state with an active-draft apply gate', () => {
    expect(optimizerToolsSource).toContain(
      'useState<OptimizerStaleSuccessReference | null>(null)',
    )
    expect(optimizerToolsSource).toContain(
      'captureStaleSuccessReference(',
    )
    expect(optimizerToolsSource).toContain(
      'effectiveReason',
    )
    expect(optimizerToolsSource).toContain(
      'setStaleSuccessReference(null)',
    )
    expect(optimizerToolsSource).toContain(
      'optimizerInputRevisionToken',
    )
    expect(optimizerToolsSource).toContain(
      'currentCanonicalDeliveryUiFingerprint',
    )
    expect(optimizerToolsSource).toContain(
      'runState.inputRevisionToken === currentInputRevisionToken',
    )
    expect(optimizerToolsSource).toContain(
      'runStateIsCurrentSuccess',
    )
    expect(optimizerToolsSource).toContain(
      '上一份成功規劃已過期／唯讀',
    )
    expect(optimizerToolsSource).toContain(
      'readOnly || deliveryUiState.status',
    )
    expect(optimizerToolsSource).not.toContain(
      'STALE_SUCCESS_STORAGE_KEY',
    )
  })

  it('replans stale success through the current canonical input pipeline', () => {
    expect(optimizerToolsSource).toContain(
      'onReplan={runOptimizer}',
    )
    expect(optimizerToolsSource).toContain(
      'materialSourceMode={materialSourceMode}',
    )
    expect(optimizerToolsSource).toContain(
      'customerCount={customerIds.length}',
    )

    const runStart = optimizerToolsSource.indexOf(
      'async function runOptimizer()',
    )
    const runEnd = optimizerToolsSource.indexOf(
      'function cancelOptimizer()',
      runStart,
    )
    const runSource = optimizerToolsSource.slice(runStart, runEnd)

    expect(runStart).toBeGreaterThanOrEqual(0)
    expect(runEnd).toBeGreaterThan(runStart)
    expect(runSource).toContain('customerIds,')
    expect(runSource).toContain('currentProgress,')
    expect(runSource).toContain('suppliedCustomerIds,')
    expect(runSource).toContain('satisfactionByVillage,')
    expect(runSource).toContain('formalCustomerIds,')
    expect(runSource).toContain(
      'ingredientUnits: { ...inventoryState.ingredientUnits }',
    )
    expect(runSource).toContain(
      '...(inventoryState.intermediateJuiceUnits ?? {})',
    )
    expect(runSource).toContain(
      'initialAvailableJuiceJars: accessibleJuiceJars.map',
    )
    expect(runSource).toContain(
      'buildPreparationShortfall(\n        preparationDemand,\n        inventoryState,',
    )
    expect(runSource).toContain(
      'basis: {\n              inventory: inventoryState,\n              currentProgress,\n              satisfactionByVillage,\n              formalCustomerIds,\n              suppliedCustomerIds,',
    )
    expect(runSource).not.toContain(
      'visibleStaleSuccessReference.run',
    )
  })

  it('keeps stale success reference when a new optimizer run fails', () => {
    const runStart = optimizerToolsSource.indexOf(
      'async function runOptimizer()',
    )
    const cancelledGuard = optimizerToolsSource.indexOf(
      'if (isOptimizerWorkerCancelledError(error))',
      runStart,
    )
    const catchStart = optimizerToolsSource.lastIndexOf(
      '} catch (error) {',
      cancelledGuard,
    )
    const finallyStart = optimizerToolsSource.indexOf(
      '} finally {',
      cancelledGuard,
    )
    const optimizerCatchSource = optimizerToolsSource.slice(
      catchStart,
      finallyStart,
    )

    expect(runStart).toBeGreaterThanOrEqual(0)
    expect(cancelledGuard).toBeGreaterThan(runStart)
    expect(catchStart).toBeGreaterThan(runStart)
    expect(catchStart).toBeLessThan(cancelledGuard)
    expect(finallyStart).toBeGreaterThan(cancelledGuard)
    expect(optimizerCatchSource).toContain(
      'error: presentPlanningError(error)',
    )
    expect(optimizerCatchSource).not.toContain(
      'setStaleSuccessReference',
    )
  })

  it('keeps manual delivery checks record-only', () => {
    expect(optimizerToolsSource).toContain(
      'Manual checklist edits are record corrections only.',
    )
    expect(optimizerToolsSource).toContain(
      '這次手動勾選只更新「今日已供應」；不修改庫存、果汁罐、杯具或製作狀態。',
    )
  })
})
