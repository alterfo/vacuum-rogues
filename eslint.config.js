import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Flat config (eslint 9+). Mirrors the previous `.eslintrc.json`:
// eslint:recommended + @typescript-eslint/recommended, browser+es2022 globals,
// with the same three rule overrides. The lint script targets `src` (see
// package.json); the ignores below keep non-source dirs out of the default run.
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      // ESLint 9 promoted these into `eslint:recommended` (and added
      // `no-useless-assignment` outright). They were NOT part of the eslint-8
      // contract this codebase was clean under, so keep them off to make this a
      // pure dependency bump — tightening them + fixing the dead stores they
      // flag is a separate lint-cleanup concern, not a security upgrade.
      'no-useless-assignment': 'off',
      'no-constant-binary-expression': 'off',
    },
  },
);
