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
        path: '^src/(services|background|content|popup|options)\\.ts$',
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
        path: '^src/(background|content|popup|options)\\.ts$',
      },
    },
    {
      name: 'entrypoints-are-independent',
      comment: 'Runtime entrypoints should remain isolated from one another.',
      severity: 'error',
      from: {
        path: '^src/(background|content|popup|options)\\.ts$',
      },
      to: {
        path: '^src/(background|content|popup|options)\\.ts$',
      },
    },
  ],
  options: {
    includeOnly: '^src',
    exclude: {
      path: '\\.(test|spec)\\.ts$|^src/test-helpers/',
    },
    doNotFollow: {
      path: 'node_modules',
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
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
