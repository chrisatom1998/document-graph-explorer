import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Flat ESLint config. The high-value rule for this React 19 + R3F app is
 * react-hooks/rules-of-hooks (kept an error) — it catches conditional/early-
 * return hook usage that TypeScript can't see. exhaustive-deps stays a warning.
 * Unused-vars is left to TypeScript (noUnusedLocals/Parameters in tsconfig) so
 * findings aren't reported twice.
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.worker },
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
    },
  },
  {
    // Node context: tests and build config.
    files: ['**/*.test.ts', '*.config.{ts,js}', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
