import { defineConfig } from 'vite';
import path from 'path';
import obfuscator from 'rollup-plugin-obfuscator';

export default defineConfig(({ mode }) => ({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: mode !== 'production',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/index.html'),
        // testing.html is a dev-only ONNX harness that lives outside the Vite
        // root; it is intentionally excluded from the production build (use it
        // via `npm run dev`).
      },
      plugins:
        mode === 'production'
          ? [
              obfuscator({
                global: true,
                options: {
                  compact: true,
                  controlFlowFlattening: true,
                  stringArray: true,
                  stringArrayEncoding: ['base64'],
                  identifierNamesGenerator: 'hexadecimal',
                  selfDefending: true,
                },
              }),
            ]
          : [],
    },
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
    __DEBUG__: JSON.stringify(mode === 'development'),
    __BUILD_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  // Add worker type declarations
  assetsInclude: ['**/*.worker.ts'],
}));
