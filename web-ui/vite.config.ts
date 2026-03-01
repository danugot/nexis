import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    allowedHosts: ["nexis.ahagoing.cc"],
    proxy: {
      '/api': {
        target: 'http://rag_api:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/agent': {
        target: 'http://agent_api:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agent/, '')
      }
    }
  }
})
