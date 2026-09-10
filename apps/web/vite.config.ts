import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { parsePort } from './serve.mjs'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    // Lane worktrees run their own web and API on distinct ports so they never
    // collide with the shared dev servers. Both must come from the lane's .env:
    // a lane that serves its own UI while proxying to the shared API renders a
    // page that looks correct and is measuring the wrong branch.
    port: parsePort(process.env.OBITER_WEB_PORT),
    proxy: {
      '/api': {
        target: process.env.OBITER_API_ORIGIN ?? 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
  plugins: [tanstackStart(), tailwindcss(), react()],
})
