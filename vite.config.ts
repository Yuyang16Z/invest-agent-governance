import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 使用相对路径，便于部署到 GitHub Pages 子路径；路由用 HashRouter。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as any);
