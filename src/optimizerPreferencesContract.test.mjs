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
