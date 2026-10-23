import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
// base 必须是绝对路径 '/circuit/'（而非 './'）：BrowserRouter 用 import.meta.env.BASE_URL
// 作为 basename，相对 base 会让路由跳到站点根下的 /editor，刷新即 404。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/circuit/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@headlessui/react', '@radix-ui/react-dialog', '@radix-ui/react-label', '@radix-ui/react-slot'],
          motion: ['framer-motion'],
        },
      },
    },
    target: 'es2020',
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api/lab': {
        target: 'http://127.0.0.1:8080',
        rewrite: (path) => path.replace(/^\/api\/lab/, ''),
        // 内核只认带令牌的请求（设计记录 D17）；手工起内核时两边都默认用开发令牌
        headers: { 'X-Zhifan-Ext-Token': process.env.SIMULEARN_TOKEN ?? 'simulearn-dev' },
      },
    },
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    passWithNoTests: true,
  },
}))
