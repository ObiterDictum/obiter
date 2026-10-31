import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    build: {
      manifest: true,
      minify: true,
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, './src/renderer/src'),
      },
    },
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
