import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Build-time default for the packaged API origin. The main process resolves
 * the real value at runtime (process.env.OBITER_API_ORIGIN ?? this default) and
 * exposes it to the renderer via the preload bridge, so an operator points the
 * packaged app at an API by setting OBITER_API_ORIGIN on the launched process
 * without rebuilding. The default is the production API origin an unsigned
 * build expects when no env var is set.
 *
 * Stringified because `define` does raw token replacement; a bare string would
 * be inserted as an identifier, not a literal.
 */
const PACKAGED_API_ORIGIN_DEFAULT = JSON.stringify(
  process.env.OBITER_API_ORIGIN_DEFAULT ?? 'https://api.obiter.dev',
)

export default defineConfig({
  main: {
    define: {
      __PACKAGED_API_ORIGIN_DEFAULT__: PACKAGED_API_ORIGIN_DEFAULT,
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, './src/renderer/src'),
      },
    },
    // apiUrl() returns relative /api/... paths in window contexts, so the
    // renderer dev server must proxy them to the API — mirrors apps/web.
    server: {
      proxy: {
        '/api': {
          target: process.env.OBITER_API_ORIGIN ?? 'http://localhost:8787',
          changeOrigin: false,
        },
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
