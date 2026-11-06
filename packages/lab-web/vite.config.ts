import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
// 构建产物用相对 base：同一份 dist 既挂在开发态网关的 /circuit/，也挂在知帆拓展的 /ext/<id>/ui/
// （约定 §3 要求页面只用相对路径）。路由走 hash，不依赖 base。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
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
