import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
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
