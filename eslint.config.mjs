import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import sonarjs from 'eslint-plugin-sonarjs';

const strictTypeScriptRules = {
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
  ],
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/strict-boolean-expressions': 'error',
  '@typescript-eslint/prefer-nullish-coalescing': 'error',
  '@typescript-eslint/prefer-optional-chain': 'error',
  complexity: ['error', { max: 15 }],
  'max-depth': ['error', { max: 4 }],
  'max-statements': ['warn', { max: 30 }],
  'no-console': 'error',

  // SonarQube-style quality rules for maintainability and bug risk.
  'sonarjs/no-all-duplicated-branches': 'error',
  'sonarjs/no-duplicated-branches': 'error',
  'sonarjs/no-identical-expressions': 'error',
  'sonarjs/no-identical-conditions': 'error',
  'sonarjs/no-ignored-return': 'error',
  'sonarjs/no-collapsible-if': 'error',
  'sonarjs/no-redundant-assignments': 'error',
  'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
  'jsdoc/check-alignment': 'error',
  'jsdoc/check-tag-names': 'error',
  'jsdoc/require-description': 'error',
  'jsdoc/require-jsdoc': ['error', {
    publicOnly: true,
    require: {
      FunctionDeclaration: true,
      ClassDeclaration: true,
      MethodDefinition: false,
    },
  }],
  'jsdoc/require-param-type': 'off',
  'jsdoc/require-returns-type': 'off',
  'jsdoc/require-param-description': 'off',
  'jsdoc/require-returns-description': 'off',
};

const testTypeScriptRuleOverrides = {
  '@typescript-eslint/no-non-null-assertion': 'off',
  'jsdoc/check-alignment': 'off',
  'jsdoc/check-tag-names': 'off',
  'jsdoc/require-description': 'off',
  'jsdoc/require-jsdoc': 'off',
  'no-console': 'off',
};

export default [
  // Ignore patterns
  {
    ignores: ['dist/**', 'node_modules/**', 'build/**'],
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
        ...globals.es2025,
        ...globals.webextensions,
      },
    },
    rules: {
      // Google TypeScript Style Guide rules
      '@typescript-eslint/no-explicit-any': 'error',
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

  // Node.js script files
  {
    files: ['**/*.{js,cjs,mjs}', '.dependency-cruiser.cjs'],
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

  // TypeScript production files
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/test-helpers/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      jsdoc,
      sonarjs,
    },
    rules: strictTypeScriptRules,
  },

  // Test TypeScript files (same strict baseline with explicit exceptions)
  {
    files: ['src/**/*.test.ts', 'src/test-helpers/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.test.json'],
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      jsdoc,
      sonarjs,
    },
    rules: {
      ...strictTypeScriptRules,
      ...testTypeScriptRuleOverrides,
    },
  },

  // Console output is allowed only in logger utility and test code.
  {
    files: ['src/lib/utils.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // MV3 service worker: Chrome disallows top-level await
  {
    files: ['src/background.ts'],
    rules: {
      'prefer-top-level-await': 'off',
    },
  },

  // Content script is executed as a classic script (no top-level await)
  {
    files: ['src/content.ts'],
    rules: {
      'prefer-top-level-await': 'off',
    },
  },
];
