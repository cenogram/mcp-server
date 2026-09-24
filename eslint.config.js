import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // scripts/ holds build-time tooling (e.g. generate-tool-reference.ts) that lives outside the
  // build tsconfig (rootDir: src), so the type-aware project service cannot resolve it. It never
  // ships to dist — exclude it from lint rather than force it into the compiled program.
  { ignores: ['dist', 'vitest.config.ts', 'scripts/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
    },
  },
)
