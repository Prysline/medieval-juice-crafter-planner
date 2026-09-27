import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OptimizerTools } from './OptimizerTools'
import { buildRecipeCandidatePool } from './domain/recipeCandidatePool'

const PROFILE_PROGRESS = 'juice-blender-unlocked' as const

class MemoryStorage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function measure(render: () => string, iterations = 3) {
  render()
  const samples: number[] = []
  let html = ''
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now()
    html = render()
    samples.push(performance.now() - startedAt)
  }
  return { medianMs: median(samples), htmlChars: html.length }
}

describe('optimizer first-activation responsiveness profile', () => {
  it('measures inactive vs active render cost with production-scale search authority', () => {
    const storage = new MemoryStorage()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    })

    const recipeCandidatePool = buildRecipeCandidatePool(PROFILE_PROGRESS)
    const commonProps = {
      currentProgress: PROFILE_PROGRESS,
      satisfactionByVillage: {
        'east-harbor': 9999,
        'tranquil-fountain': 9999,
        'ibex-statue': 9999,
      },
      suppliedCustomerIds: [],
      formalCustomerIds: [],
      recipeCandidatePool,
      onSuppliedCustomerIdsCommitted: () => {},
      onFormalCustomerIdsCommitted: () => {},
    }

    const inactive = measure(() =>
      renderToStaticMarkup(
        <OptimizerTools
          {...commonProps}
          active={false}
        />,
      ),
    )
    const active = measure(() =>
      renderToStaticMarkup(
        <OptimizerTools
          {...commonProps}
          active
        />,
      ),
    )

    console.log('[optimizer-activation-profile]', {
      poolEntries: recipeCandidatePool.entries.length,
      inactive,
      active,
      activationDeltaMs: active.medianMs - inactive.medianMs,
    })

    expect(recipeCandidatePool.entries.length).toBeGreaterThan(10_000)
    expect(inactive.htmlChars).toBeGreaterThan(0)
    expect(active.htmlChars).toBe(inactive.htmlChars)
  }, 30_000)
})
