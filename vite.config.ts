import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/medieval-juice-crafter-planner/',
  plugins: [react()],
  optimizeDeps: {
    // highs-ts loads its Emscripten glue through a package-relative dynamic
    // import. Vite's dev-only dependency pre-bundling relocates the entry
    // under .vite/deps, which makes that relative asset request miss and
    // fall back to HTML. Keep the valid ESM package unbundled in dev.
    exclude: ['@bubblyworld/highs-ts'],
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      input: ['index.html', 'highs-runtime-smoke.html'],
    },
  },
})
