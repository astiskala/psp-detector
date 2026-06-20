import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import prettierConfig from 'eslint-config-prettier';

const unicornAllPreset = unicorn.configs.all;
const unicornAllRules = Object.fromEntries(
  Object.entries(unicornAllPreset.rules).map(([ruleName, setting]) => [
    ruleName,
    Array.isArray(setting) ? ['error', ...setting.slice(1)] : 'error',
  ]),
);

// Merge the rule maps from the type-aware typescript-eslint presets. These are
// layered onto the TypeScript blocks (which carry full type information via
// `projectService` / `project`) rather than spread globally, so plain JS tooling
// files are never asked for type information they don't have.
const typeCheckedRules = Object.assign(
  {},
  ...[
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
  ].map((config) => config.rules ?? {}),
);

// Full SonarJS recommended rule set (269 rules) for deep bug/maintainability
// coverage, complementing the SonarCloud server-side analysis.
const sonarjsRecommendedRules = sonarjs.configs.recommended.rules ?? {};

const strictTypeScriptRules = {
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
  ],
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/no-unnecessary-type-assertion': 'error',
  '@typescript-eslint/strict-boolean-expressions': 'error',
  '@typescript-eslint/prefer-nullish-coalescing': 'error',
  '@typescript-eslint/prefer-optional-chain': 'error',
  '@typescript-eslint/no-meaningless-void-operator': 'error',
  // Lock class fields that are only assigned in the constructor as `readonly`,
  // and flag the remaining type-safety gaps the strict preset leaves open.
  '@typescript-eslint/prefer-readonly': 'error',
  '@typescript-eslint/no-unnecessary-parameter-property-assignment': 'error',
  '@typescript-eslint/no-unsafe-unary-minus': 'error',
  '@typescript-eslint/no-confusing-void-expression': [
    'error',
    { ignoreArrowShorthand: true },
  ],
  // --- Type-aware preset tuning for this codebase's deliberate patterns ---
  // Interpolating primitives into log lines and runtime messages is safe; the
  // genuine "[object Object]" hazard is still caught by no-base-to-string below.
  '@typescript-eslint/restrict-template-expressions': [
    'error',
    {
      allowNumber: true,
      allowBoolean: true,
      allowNever: true,
      allowRegExp: true,
    },
  ],
  // no-unnecessary-condition fights this extension's defensive runtime guards:
  // chrome.* namespaces are typed as always-present but are `undefined` at
  // runtime without the matching permission (e.g. chrome.webRequest), branded
  // types are compared against string sentinels, and `while (true)` loops are
  // idiomatic. Keeping these checks is safer than satisfying the type-only view;
  // SonarCloud still reports genuinely dead branches server-side.
  '@typescript-eslint/no-unnecessary-condition': 'off',
  // Counterpart to the above — fires on intentional branded-type/sentinel
  // comparisons (PSPName/TabId vs string | undefined).
  'sonarjs/different-types-comparison': 'off',
  // Async functions are passed to DOM/chrome event listeners by design — those
  // handlers own their try/catch, and chrome lifecycle listeners (onInstalled)
  // deliberately return a promise to keep the MV3 worker alive. The codebase has
  // no async array-callbacks (forEach/map/…), so disabling only the `arguments`
  // check loses no real coverage; conditional/spread misuse stays caught.
  '@typescript-eslint/no-misused-promises': [
    'error',
    { checksVoidReturn: { arguments: false } },
  ],
  // Redundant with the mandatory @typescript-eslint/explicit-function-return-type
  // and wrong for intentional union returns (sanitizers/parsers/normalizers that
  // legitimately return `string | number | boolean`). TypeScript governs return
  // shape here; this stylistic constraint does not.
  'sonarjs/function-return-type': 'off',

  complexity: ['error', { max: 15 }],
  'max-depth': ['error', { max: 3 }],
  'max-statements': ['error', { max: 30 }],
  'no-console': 'error',
  // `void` is permitted only as a statement — the idiomatic, explicit marker for
  // a deliberately unawaited promise (pairs with @typescript-eslint/no-floating-promises).
  'no-void': ['error', { allowAsStatement: true }],
  'prefer-template': 'error',

  // SonarQube-style quality rules for maintainability and bug risk.
  'sonarjs/no-all-duplicated-branches': 'error',
  'sonarjs/no-duplicated-branches': 'error',
  'sonarjs/no-identical-expressions': 'error',
  'sonarjs/no-identical-conditions': 'error',
  'sonarjs/no-ignored-return': 'error',
  'sonarjs/no-collapsible-if': 'error',
  'sonarjs/no-redundant-assignments': 'error',
  'sonarjs/no-duplicate-string': ['error', { threshold: 5 }],
  'sonarjs/no-inverted-boolean-check': 'error',
  'jsdoc/check-alignment': 'error',
  'jsdoc/check-tag-names': 'error',
  'jsdoc/require-description': 'error',
  'jsdoc/require-jsdoc': [
    'error',
    {
      publicOnly: true,
      require: {
        FunctionDeclaration: true,
        ClassDeclaration: true,
        MethodDefinition: false,
      },
    },
  ],
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
  // setHTML() is not available in jsdom — tests use innerHTML for fixture setup
  'unicorn/prefer-dom-node-html-methods': 'off',
  'unicorn/no-unsafe-dom-html': 'off',
  // TypeScript narrowing (e.g. `typeof query === 'string'`) satisfies safety but
  // the rule doesn't follow narrowed union types — suppress in tests only
  'unicorn/no-unsafe-property-key': 'off',
  // Tests mock globals: globalThis.fetch = ..., globalThis.chrome = ..., etc.
  'unicorn/no-global-object-property-assignment': 'off',
  // fetch / MutationObserver / requestIdleCallback may be absent in jsdom
  'unicorn/no-unnecessary-global-this': 'off',
  // Tests run under CommonJS/Jest where __dirname / require() are available
  'unicorn/prefer-module': 'off',

  // Type-aware relaxations for tests. Mocks (chrome.*, fetch, MutationObserver)
  // and Jest matchers legitimately produce `any`-typed and unbound-method values
  // that the strict type-checked preset would otherwise flag throughout fixtures.
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
  '@typescript-eslint/unbound-method': 'off',
  // Asserting against interpolated mock values is common and safe in test output.
  '@typescript-eslint/restrict-template-expressions': 'off',
  // Mock implementations satisfy Promise-returning API signatures (fetch, chrome)
  // without ever awaiting — the async keyword documents the contract.
  '@typescript-eslint/require-await': 'off',
  // build-artifacts tests parse our own emitted bundles with `new vm.Script(...)`
  // to assert they are valid classic scripts — trusted input, marked NOSONAR.
  'sonarjs/code-eval': 'off',
  // Mock signatures mirror chrome/jest callback contracts whose return positions
  // legitimately use `void` in unions and generic type arguments.
  '@typescript-eslint/no-invalid-void-type': 'off',
  // Typed DOM-accessor fixtures use caller-supplied element-type casts.
  '@typescript-eslint/no-unnecessary-type-parameters': 'off',
};

export default [
  // Fail on stale `eslint-disable` directives so suppressions can't outlive the
  // problems they silenced.
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  // Ignore patterns — generated build/test artifacts must never be linted.
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'build/**',
      'coverage/**',
      'test-results/**',
      'hint-report/**',
      '.playwright-mcp/**',
      '*.tsbuildinfo',
    ],
  },

  // Base configurations including gts rules
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,

  // Full unicorn preset with repo-specific exceptions.
  {
    name: 'psp-detector/unicorn-all',
    languageOptions: {
      globals: {
        ...unicornAllPreset.languageOptions.globals,
      },
    },
    plugins: {
      unicorn,
    },
    rules: unicornAllRules,
  },
  {
    name: 'psp-detector/unicorn-exceptions',
    rules: {
      // Intentional design decisions — not a style fit for this codebase
      'unicorn/consistent-class-member-order': 'off',
      // no-asterisk-prefix-in-documentation-comments conflicts with jsdoc/check-alignment:
      // one rule removes the ' * ' prefix, the other requires it
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      // no-keyword-prefix: flags 'className' (standard DOM API name) and similar legitimate identifiers
      'unicorn/no-keyword-prefix': 'off',
      // import-style default imports only in production; namespace (*) imports retained in .js/.CJS/.mjs Node tooling
      'unicorn/import-style': 'error',
      // Threshold of 4 (one above the unicorn default) avoids churn on the one deep call in tests
      'unicorn/max-nested-calls': ['error', { max: 4 }],
      // Threshold aligns with the existing cyclomatic-complexity ceiling (max 15); try blocks rarely need that depth
      'unicorn/try-complexity': ['error', { max: 8 }],
      'unicorn/prefer-abbreviations': 'off',
      'unicorn/prefer-dispose': 'off',
      'unicorn/prefer-path2d': 'off',
      'unicorn/prefer-temporal': 'off',
      // rel is a legitimate HTML attribute name, not an abbreviation
      'unicorn/prevent-abbreviations': ['error', { allowList: { rel: true } }],
    },
  },

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
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-var-requires': 'error',
      curly: ['error', 'multi-line'],
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
      // Node.js tools use CommonJS/require — prefer-module would flag all require() calls
      'unicorn/prefer-module': 'off',
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
    // Layering order: generic SonarJS recommended → type-aware strict/stylistic
    // presets → the repo's curated rules (final authority, may tighten options).
    rules: {
      ...sonarjsRecommendedRules,
      ...typeCheckedRules,
      ...strictTypeScriptRules,
    },
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
      ...sonarjsRecommendedRules,
      ...typeCheckedRules,
      ...strictTypeScriptRules,
      ...testTypeScriptRuleOverrides,
    },
  },

  // Console output is allowed only in logger utility and test code.
  {
    files: ['src/lib/utilities.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // MV3 service worker: Chrome disallows top-level await
  {
    files: ['src/background.ts'],
    rules: {
      'unicorn/prefer-top-level-await': 'off',
    },
  },

  // Content script is executed as a classic script (no top-level await)
  {
    files: ['src/content.ts'],
    rules: {
      'unicorn/prefer-top-level-await': 'off',
    },
  },

  // Disable ESLint formatting rules that conflict with Prettier.
  prettierConfig,
];
