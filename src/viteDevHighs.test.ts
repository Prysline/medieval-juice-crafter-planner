import { describe, expect, it } from 'vitest'
import { createServer } from 'vite'
import viteConfig from '../vite.config'

describe('Vite HiGHS development loading', () => {
  it(
    'serves the package-relative HiGHS WASM as WebAssembly instead of HTML',
    async () => {
      const config = viteConfig
      const server = await createServer({
        ...config,
        configFile: false,
        base: '/',
        logLevel: 'silent',
        server: {
          ...config.server,
          host: '127.0.0.1',
          port: 0,
          strictPort: false,
        },
      })

      try {
        await server.listen()

        const address = server.httpServer?.address()
        if (!address || typeof address === 'string') {
          throw new Error('Vite dev server did not expose a TCP port')
        }
        const origin = `http://127.0.0.1:${address.port}`

        const optimizerModule = await server.transformRequest(
          '/src/domain/optimizerHighsSolver.ts',
        )
        expect(optimizerModule?.code).toBeTruthy()

        const highsModulePath = optimizerModule?.code.match(
          /from\s+["']([^"']*highs-ts[^"']*)["']/,
        )?.[1]
        expect(highsModulePath).toBeTruthy()
        expect(highsModulePath).not.toContain('/.vite/deps/')

        const highsModuleUrl = new URL(highsModulePath!, origin)
        const highsModuleResponse = await fetch(highsModuleUrl)
        expect(highsModuleResponse.status).toBe(200)
        const highsModuleSource = await highsModuleResponse.text()

        const glueSpecifier = highsModuleSource.match(
          /import\(\s*["']([^"']*build\/highs\.js[^"']*)["']\s*\)/,
        )?.[1]
        expect(glueSpecifier).toBeTruthy()

        const glueUrl = new URL(glueSpecifier!, highsModuleUrl)
        const glueResponse = await fetch(glueUrl)
        expect(glueResponse.status).toBe(200)

        const wasmUrl = new URL('highs.wasm', glueUrl)
        const wasmResponse = await fetch(wasmUrl)
        expect(wasmResponse.status).toBe(200)

        const wasmBytes = new Uint8Array(
          await wasmResponse.arrayBuffer(),
        )
        expect(Array.from(wasmBytes.slice(0, 4))).toEqual([
          0x00, 0x61, 0x73, 0x6d,
        ])
      } finally {
        await server.close()
      }
    },
    30_000,
  )
})
