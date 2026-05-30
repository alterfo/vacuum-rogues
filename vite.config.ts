import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: {
    format: 'es',
  },
  define: {
    __DEBUG__: JSON.stringify(process.env.NODE_ENV === 'development'),
    __BUILD_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  // Add worker type declarations
  assetsInclude: ['**/*.worker.ts'],
});
