import path from "path"
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  return {
    base: env.VITE_BASE_URL || '/',
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: true,
      allowedHosts: ["nexis.ahagoing.cc", "www.quirklabs.top"],
      hmr: {
        protocol: env.VITE_HMR_PROTOCOL || undefined,
        host: env.VITE_HMR_HOST || undefined,
        port: env.VITE_HMR_PORT ? parseInt(env.VITE_HMR_PORT) : undefined,
        clientPort: env.VITE_HMR_CLIENT_PORT ? parseInt(env.VITE_HMR_CLIENT_PORT) : undefined,
      },
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
  }
})
