import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Flat ESLint config. The high-value rule for this React 19 + R3F app is
 * react-hooks/rules-of-hooks (kept an error) — it catches conditional/early-
 * return hook usage that TypeScript can't see. exhaustive-deps stays a warning.
 * Unused-vars is left to TypeScript (noUnusedLocals/Parameters in tsconfig) so
 * findings aren't reported twice.
 *
 * The ts/tsx block below opts into typed linting (parserOptions.projectService)
 * ONLY to power `@typescript-eslint/no-floating-promises` — a real hazard in an
 * app with fire-and-forget worker/cache/network calls (an unhandled rejection
 * silently drops a user-facing error). This is intentionally NOT
 * `recommendedTypeChecked`: that pulls in a much larger, slower rule set this
 * codebase hasn't been audited against.
 */
export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-airgap',
      'node_modules',
      'public',
      'coverage',
      'release',
      'release-build',
      'copilot-worktrees',
      'document-graph-explorer',
      '.codex',
      '.cursor',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.worker },
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // TypeScript owns unused-vars (see tsconfig); don't double-report.
      '@typescript-eslint/no-unused-vars': 'off',
      // Pragmatic for a graphics/worker codebase with justified escape hatches.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      // A dropped promise (network/cache/worker call) fails silently — no
      // console error, no user-facing toast, just a missing side effect.
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Node context: tests, build config, and the .mjs build/verify scripts.
    files: ['**/*.test.ts', '*.config.{ts,js}', 'vite.config.ts', '**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // Electron main process + CommonJS Node scripts (the pkg-packaged exe
    // entry must stay CJS too): requires `require`/`__dirname`.
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
