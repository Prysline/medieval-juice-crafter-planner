import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const optimizerToolsSource = readFileSync(
  new URL('./OptimizerTools.tsx', import.meta.url),
  'utf8',
)

describe('delivery checkbox and whole-plan application contract', () => {
  it('rebases compatible supplied checks instead of discarding the transaction draft', () => {
    expect(optimizerToolsSource).toContain(
      'rebasePlanApplicationTransactionSuppliedCustomers(',
    )
    expect(optimizerToolsSource).toContain(
      'transactionDraft: rebasedTransactionDraft',
    )
    expect(optimizerToolsSource).toContain(
      'transactionDraftInvalidatedByPartialDelivery:\n          rebasedTransactionDraft === null',
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
