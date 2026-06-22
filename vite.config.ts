import { defineConfig } from 'vite';
import path from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import obfuscator from 'rollup-plugin-obfuscator';

// Resolve the build's git SHA for the feedback diagnostics. PREFER the actual
// checked-out commit (`git rev-parse --short HEAD`): the deployed build runs in a
// SEPARATE repo's CI (the alterfo blog fetches this repo's master and builds it —
// see .github/workflows/notify-alterfo.yml), where GITHUB_SHA is the *blog's*
// commit and useless for triaging a game report. The game checkout's HEAD is the
// real game SHA. Only fall back to GITHUB_SHA when local git is unavailable (this
// repo's own CI without a full checkout), then 'dev' (source tarball, no git).
function resolveBuildSha(): string {
  try {
    const local = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (local) return local;
  } catch {
    /* git unavailable — fall through to the CI env var */
  }
  const ci = process.env.GITHUB_SHA;
  return ci ? ci.slice(0, 7) : 'dev';
}

// Read the version straight from package.json so it is correct regardless of how
// the build is invoked. `process.env.npm_package_version` is only populated when
// vite runs *through* an npm script; the cross-repo deploy may call `vite build`
// directly, which would silently degrade the diagnostics version to 'dev'.
function resolveBuildVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
    ) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.length > 0
      ? pkg.version
      : 'dev';
  } catch {
    return 'dev';
  }
}

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
    __BUILD_VERSION__: JSON.stringify(resolveBuildVersion()),
    __BUILD_SHA__: JSON.stringify(resolveBuildSha()),
  },
  // NOTE: do NOT add `assetsInclude: ['**/*.worker.ts']` — it forces Vite to
  // treat the worker as a static asset and inline its RAW TypeScript (served as
  // video/mp2t), which breaks the prod build. Workers are loaded via the
  // `?worker` import in ONNXModelRegistry, so Vite compiles them properly.
}));
