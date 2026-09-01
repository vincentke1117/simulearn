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
      '/api': 'http://127.0.0.1:8123',
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
