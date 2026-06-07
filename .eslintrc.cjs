/* ESLint configuration (legacy .eslintrc format on ESLint v8).
 * Kept untyped (no parserOptions.project) — type-checking is owned by `tsc --noEmit`.
 * Prettier owns formatting via eslint-config-prettier.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage', '*.cjs'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
};
