import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config'

describe('Vite development configuration', () => {
  it('keeps highs-ts out of dev dependency pre-bundling', () => {
    const config =
      typeof viteConfig === 'function'
        ? viteConfig({ command: 'serve', mode: 'development', isSsrBuild: false, isPreview: false })
        : viteConfig

    expect(config.optimizeDeps?.exclude).toContain(
      '@bubblyworld/highs-ts',
    )
  })
})
