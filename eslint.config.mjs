import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  // Ignore patterns
  {
    ignores: ['dist/**', 'node_modules/**', 'build/**', '.prettierrc.js'],
  },

  // Base configurations including gts rules
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,

  // General settings for all files
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.webextensions,
      },
    },
    rules: {
      // Google TypeScript Style Guide rules
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-var-requires': 'error',

      // Code formatting and style
      indent: ['error', 2],
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'space-before-function-paren': ['error', 'never'],
      'keyword-spacing': ['error', { before: true, after: true }],
      'space-infix-ops': 'error',
      'eol-last': 'error',
      'no-trailing-spaces': 'error',
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
      'brace-style': ['error', '1tbs', { allowSingleLine: true }],
      curly: ['error', 'multi-line'],
      'max-len': ['error', { code: 80, ignoreUrls: true, ignoreStrings: true }],
      'lines-around-comment': ['error', {
        beforeBlockComment: true,
        beforeLineComment: true,
        allowBlockStart: true,
        allowObjectStart: true,
        allowArrayStart: true,
        allowClassStart: true,
        applyDefaultIgnorePatterns: false,
      }],
      'padding-line-between-statements': ['error',
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: 'multiline-expression', next: '*' },
      ],
    },
  },

  // Node.js build files
  {
    files: ['build.js', 'jest.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-undef': 'off',
    },
  },

  // TypeScript source files
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];
