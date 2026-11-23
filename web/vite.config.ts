import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Pyodide is loaded from the CDN at runtime; the npm package is only for types and the bench
  optimizeDeps: { exclude: ['pyodide'] },
})
