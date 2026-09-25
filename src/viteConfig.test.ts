import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config'

describe('Vite configuration', () => {
  it('keeps highs-ts out of dev dependency pre-bundling', () => {
    expect(viteConfig.optimizeDeps?.exclude).toContain(
      '@bubblyworld/highs-ts',
    )
  })

  it('keeps the production HiGHS runtime smoke under the Pages base path', () => {
    expect(viteConfig.base).toBe('/medieval-juice-crafter-planner/')
    expect(viteConfig.worker?.format).toBe('es')
    expect(viteConfig.build?.rollupOptions?.input).toEqual(
      expect.arrayContaining([
        'index.html',
        'highs-runtime-smoke.html',
      ]),
    )
  })
})
