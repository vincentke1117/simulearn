import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  test: {
    // 需要 DOM 的测试在文件头用 `// @vitest-environment jsdom` 自行声明，
    // 避免这里维护两份 unit/dom 的 include/exclude 清单
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  server: {
    proxy: {
      // 内核只认带令牌的请求（设计记录 D17）；手工起内核时两边都默认用开发令牌
      '/api': {
        target: 'http://127.0.0.1:8123',
        headers: { 'X-Zhifan-Ext-Token': process.env.SIMULEARN_TOKEN ?? 'simulearn-dev' },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
