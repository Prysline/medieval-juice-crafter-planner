import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const optimizerToolsSource = readFileSync(
  new URL('./OptimizerTools.tsx', import.meta.url),
  'utf8',
)

describe('optimizer preferences wiring regression', () => {
  it('hydrates optimizer inputs from local storage without restoring a run result', () => {
    expect(optimizerToolsSource).toContain(
      'readOptimizerPreferences(window.localStorage)',
    )
    expect(optimizerToolsSource).toContain(
      'initialOptimizerPreferences.candidatePolicy',
    )
    expect(optimizerToolsSource).toContain(
      'initialOptimizerPreferences.primaryCriterion',
    )
    expect(optimizerToolsSource).toContain(
      'initialOptimizerPreferences.selectedCustomerIds',
    )
    expect(optimizerToolsSource).toContain(
      'initialOptimizerPreferences.activeWorkshopRegionId',
    )
    expect(optimizerToolsSource).toContain(
      "useState<OptimizerRunState>({\n    status: 'idle',\n  })",
    )
  })

  it('distinguishes saved target selections from current eligibility', () => {
    expect(optimizerToolsSource).toContain(
      '已選擇 {selectedCustomerIds.length} 人 · 本次可規劃',
    )
    expect(optimizerToolsSource).toContain(
      '{effectiveSelectedCustomerCount} / {targetableCustomerCount} 人',
    )
    expect(optimizerToolsSource).toContain(
      '位目前不符合主線、滿意度、顧客身分或今日已供應條件；選擇會保留',
    )
    expect(optimizerToolsSource).toContain(
      '已選擇 {selectedVillageIds.length} 個村莊 · 本次可規劃',
    )
    expect(optimizerToolsSource).toContain(
      '{effectiveSelectedVillageIds.length} / {targetableVillageIds.length}',
    )
    expect(optimizerToolsSource).toContain(
      '個已選擇村莊目前沒有符合條件的可規劃顧客；選擇會保留',
    )
  })

  it('writes only player-authored optimizer inputs when controls change', () => {
    const writeStart = optimizerToolsSource.indexOf(
      'writeOptimizerPreferences(window.localStorage, {',
    )
    expect(writeStart).toBeGreaterThanOrEqual(0)

    const writeEnd = optimizerToolsSource.indexOf(
      '  const priorities = useMemo(',
      writeStart,
    )
    const writeBlock = optimizerToolsSource.slice(
      writeStart,
      writeEnd,
    )

    for (const field of [
      'scope',
      'targetMode',
      'selectedVillageIds',
      'selectedCustomerIds',
      'candidatePolicy',
      'materialSourceMode',
      'primaryCriterion',
      'secondaryOne',
      'secondaryTwo',
      'maxJarFillOperations',
      'activeWorkshopRegionId',
    ]) {
      expect(writeBlock).toContain(field)
    }

    expect(writeBlock).not.toContain('runState')
    expect(writeBlock).not.toContain('transactionDraft')
    expect(writeBlock).not.toContain('salesTripPlans')
    expect(writeBlock).not.toContain('productionLogistics')
  })
})
