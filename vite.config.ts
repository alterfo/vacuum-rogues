import { defineConfig } from 'vite';
import path from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import obfuscator from 'rollup-plugin-obfuscator';

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
      },
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
}));
