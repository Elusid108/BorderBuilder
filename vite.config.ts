import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  base: '/BorderBuilder/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // The geometry worker imports modules (and manifold's WASM), so it must be an ES worker.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
})
