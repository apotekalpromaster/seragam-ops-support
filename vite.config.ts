/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // PGlite (mode demo) memuat file WASM sendiri; jangan di-prebundle.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { chunkSizeWarningLimit: 1500 },
  test: { include: ['supabase/tests/**/*.test.ts', 'src/**/*.test.ts'], testTimeout: 60000, fileParallelism: false },
})
