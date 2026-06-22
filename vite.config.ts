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
      // Obfuscation is OPT-IN (`OBFUSCATE=1 npm run build`), not on by default.
      // With `global: true` it processed the WHOLE bundle and corrupted Vite's
      // dynamic-import URL placeholders — onnxruntime's `browserAll-<hash>.js`
      // came out as `browserAll-!~{003}~.js` → 404 → game init crash. It also
      // broke PixiJS enum init (the DXT1 crash). A plain `npm run build` (what we
      // use for testing) now ships a clean, working bundle. When you DO obfuscate
      // for a release, it runs per-module (`global: false`) and skips vendor
      // (`exclude` node_modules) so it can't mangle library chunks or Vite's
      // placeholders — verify that build before shipping.
      plugins:
        mode === 'production' && process.env.OBFUSCATE === '1'
          ? [
              obfuscator({
                global: false,
                exclude: ['**/node_modules/**'],
                options: {
                  compact: true,
                  controlFlowFlattening: false,
                  stringArray: true,
                  stringArrayEncoding: ['base64'],
                  identifierNamesGenerator: 'hexadecimal',
                  selfDefending: false,
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
  // NOTE: do NOT add `assetsInclude: ['**/*.worker.ts']` — it forces Vite to
  // treat the worker as a static asset and inline its RAW TypeScript (served as
  // video/mp2t), which breaks the prod build. Workers are loaded via the
  // `?worker` import in ONNXModelRegistry, so Vite compiles them properly.
}));
