import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.ORMONT_API_ORIGIN ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  plugins: [tanstackStart(), tailwindcss(), react()],
})
