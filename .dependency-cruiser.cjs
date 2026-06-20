/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Circular dependencies make extension runtime behavior brittle.',
      severity: 'error',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'not-to-unresolvable',
      comment:
        'A module depends on something that cannot be resolved on disk — a typo, a missing extension, or a broken path.',
      severity: 'error',
      from: {},
      to: {
        couldNotResolve: true,
      },
    },
    {
      name: 'no-non-package-json',
      comment:
        'Module imports an npm package that is not declared in package.json (a phantom/undeclared dependency).',
      severity: 'error',
      from: {},
      to: {
        dependencyTypes: ['npm-no-pkg', 'npm-unknown'],
      },
    },
    {
      name: 'not-to-dev-dep',
      comment:
        'Production source must not depend on a devDependency — it would be missing at runtime.',
      severity: 'error',
      from: {
        path: '^src',
        pathNot: String.raw`\.(test|spec)\.ts$|^src/test-helpers/`,
      },
      to: {
        dependencyTypes: ['npm-dev'],
        // type-only imports are erased at build time, so a dev-only @types
        // package is a legitimate type-only dependency of production code.
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-duplicate-dep-types',
      comment:
        'A dependency is declared more than once in package.json (e.g. as both a dependency and a devDependency).',
      severity: 'error',
      from: {},
      to: {
        moreThanOneDependencyType: true,
        // type-only + a runtime type is an allowed, common combination.
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'not-to-deprecated',
      comment:
        'Module depends on an npm package that is flagged as deprecated by its maintainers.',
      severity: 'error',
      from: {},
      to: {
        dependencyTypes: ['deprecated'],
      },
    },
    {
      name: 'no-deprecated-core',
      comment: 'Module depends on a deprecated Node.js core module.',
      severity: 'error',
      from: {},
      to: {
        dependencyTypes: ['core'],
        path: [
          '^(?:v8/tools/codemap)$',
          '^(?:v8/tools/consarray)$',
          '^(?:v8/tools/csvparser)$',
          '^(?:v8/tools/logreader)$',
          '^(?:v8/tools/profile_view)$',
          '^(?:v8/tools/profile)$',
          '^(?:v8/tools/SourceMap)$',
          '^(?:v8/tools/splaytree)$',
          '^(?:v8/tools/tickprocessor-driver)$',
          '^(?:v8/tools/tickprocessor)$',
          '^(?:node-inspect/lib/_inspect)$',
          '^(?:node-inspect/lib/internal/inspect_client)$',
          '^(?:node-inspect/lib/internal/inspect_repl)$',
          '^(?:async_hooks)$',
          '^(?:punycode)$',
          '^(?:domain)$',
          '^(?:constants)$',
          '^(?:sys)$',
          '^(?:_linklist)$',
          '^(?:_stream_wrap)$',
        ],
      },
    },
    {
      name: 'types-are-leaf-runtime',
      comment: 'Type modules must not depend on runtime application layers.',
      severity: 'error',
      from: {
        path: '^src/types',
      },
      to: {
        path: '^src/(?!types)',
      },
    },
    {
      name: 'lib-does-not-import-app-layers',
      comment:
        'Core library utilities should stay independent of app entrypoints/services.',
      severity: 'error',
      from: {
        path: '^src/lib',
      },
      to: {
        path: String.raw`^src/(services|background|content|popup|options)\.ts$`,
      },
    },
    {
      name: 'services-do-not-import-entrypoints',
      comment: 'Services should not depend on extension entrypoint modules.',
      severity: 'error',
      from: {
        path: '^src/services',
      },
      to: {
        path: String.raw`^src/(background|content|popup|options)\.ts$`,
      },
    },
    {
      name: 'entrypoints-are-independent',
      comment: 'Runtime entrypoints should remain isolated from one another.',
      severity: 'error',
      from: {
        path: String.raw`^src/(background|content|popup|options)\.ts$`,
      },
      to: {
        path: String.raw`^src/(background|content|popup|options)\.ts$`,
      },
    },
  ],
  options: {
    includeOnly: '^src',
    exclude: {
      path: String.raw`\.(test|spec)\.ts$|^src/test-helpers/`,
    },
    doNotFollow: {
      path: 'node_modules',
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    // Analyze pre-compilation dependencies so type-only imports are part of the
    // graph — makes circular-dependency and dev-dependency checks exhaustive.
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+',
      },
    },
  },
};
