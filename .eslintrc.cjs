module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier'
  ],
  settings: { react: { version: 'detect' } },
  rules: {
    // React 17+ with the new JSX transform no longer requires importing React in every file.
    'react/react-in-jsx-scope': 'off',
    // Existing codebase has broad use of any; keep lint usable while we incrementally type-harden.
    '@typescript-eslint/no-explicit-any': 'off',
    // Allow empty catch blocks used as intentional fallback guards in UI code.
    'no-empty': ['error', { allowEmptyCatch: true }],
    // Do not fail CI on legacy unused variables during cleanup phase.
    '@typescript-eslint/no-unused-vars': 'warn',
    // Keep list rendering checks non-blocking for existing pages until they are normalized.
    'react/jsx-key': 'warn',
  }
}
