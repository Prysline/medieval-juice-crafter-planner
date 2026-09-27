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

function measureCached(render: () => string, iterations = 3) {
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
  it('separates first activation from cached active renders at production scale', () => {
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

    const renderInactive = () =>
      renderToStaticMarkup(
        <OptimizerTools
          {...commonProps}
          active={false}
        />,
      )
    const renderActive = () =>
      renderToStaticMarkup(
        <OptimizerTools
          {...commonProps}
          active
        />,
      )

    const inactive = measureCached(renderInactive)

    // Do not warm up the active path before this sample. The searchable
    // inventory indexes use WeakMap caches keyed by the pool arrays, so the
    // first active render is the one that includes the one-time index build.
    const firstActivationStartedAt = performance.now()
    const firstActiveHtml = renderActive()
    const firstActivationMs = performance.now() - firstActivationStartedAt

    const cachedActive = measureCached(renderActive)

    console.log('[optimizer-activation-profile]', {
      poolEntries: recipeCandidatePool.entries.length,
      inactive,
      firstActivation: {
        ms: firstActivationMs,
        htmlChars: firstActiveHtml.length,
      },
      cachedActive,
      activationDeltaMs: firstActivationMs - inactive.medianMs,
      cachedActivationDeltaMs: cachedActive.medianMs - inactive.medianMs,
    })

    expect(recipeCandidatePool.entries.length).toBeGreaterThan(10_000)
    expect(inactive.htmlChars).toBeGreaterThan(0)
    expect(firstActiveHtml.length).toBe(inactive.htmlChars)
    expect(cachedActive.htmlChars).toBe(inactive.htmlChars)
  }, 30_000)
})
