import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config'

describe('Vite development configuration', () => {
  it('keeps highs-ts out of dev dependency pre-bundling', () => {
    expect(viteConfig.optimizeDeps?.exclude).toContain(
      '@bubblyworld/highs-ts',
    )
  })
})
