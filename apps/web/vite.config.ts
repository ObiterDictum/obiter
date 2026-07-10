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
        target: process.env.OBITER_API_ORIGIN ?? 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
  plugins: [tanstackStart(), tailwindcss(), react()],
})
