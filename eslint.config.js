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
      'artifacts/music-evaluation/**', // Local benchmark captures and scratch harnesses.
      'release',
      'release-build',
      'copilot-worktrees',
      'document-graph-explorer',
      '.codex',
      '.cursor',
      '.vercel',
      '.agents',
      'playwright-report',
      'test-results',
      'artifacts',
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
        // scripts/score-event-windows.ts is a standalone analysis script: it is
        // not under tsconfig's include ("src", vite.config.ts, playwright.config.ts)
        // and nothing in the program imports it, so the project service cannot
        // place it and typed linting fails to parse it at all. The other
        // scripts/ entries are .mjs (untyped) or, like essentia-csp.ts, reached
        // through vite.config.ts. Let this one lint against the default project.
        projectService: { allowDefaultProject: ['scripts/score-event-windows.ts'] },
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
    files: ['src/server/**/*.ts', 'src/dev/**/*.ts', '**/*.test.ts', '*.config.{ts,js}', 'vite.config.ts', '**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // Browser-automation scripts: the body of a page.evaluate() callback runs in the
    // page, so it legitimately reaches for DOM globals from a Node-context file.
    files: ['scripts/qualify-fusion-input.mjs', 'scripts/score-dj-labels.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Electron main process + CommonJS Node scripts (the SEA-packaged exe
    // entry must stay CJS too): requires `require`/`__dirname`.
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
