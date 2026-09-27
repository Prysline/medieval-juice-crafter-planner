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

  it('keeps manual delivery checks record-only', () => {
    expect(optimizerToolsSource).toContain(
      'Manual checklist edits are record corrections only.',
    )
    expect(optimizerToolsSource).toContain(
      '這次手動勾選只更新「今日已供應」；不修改庫存、果汁罐、杯具或製作狀態。',
    )
  })
})
