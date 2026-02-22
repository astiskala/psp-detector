module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js', 'json'],

  // Module resolution
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Transform configuration for TypeScript 5.9
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
        useESM: false,
      },
    ],
  },

  // Test file patterns
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(ts|js)',
    '<rootDir>/src/**/*.(test|spec).(ts|js)',
  ],

  // Coverage configuration
  collectCoverage: false,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
  ],
  // Note: src/options.ts is excluded from unit test coverage thresholds because
  // it contains only DOM wiring code (no pure logic). It is covered by the
  // Playwright integration tests in tests/integration/options-page.spec.ts.
  coverageThreshold: {
    './src/lib/history.ts': { lines: 80, functions: 80, branches: 70 },
    './src/options-core.ts': { lines: 80, functions: 80, branches: 70 },
    './src/services/psp-detector.ts': { lines: 80, functions: 80 },
  },

  // Coverage reporter configuration
  coverageReporters: ['text', 'text-summary'],
  coverageProvider: 'v8',

  // Setup files
  setupFilesAfterEnv: [],

  // Error handling
  errorOnDeprecated: true,

  // Performance
  maxWorkers: '50%',

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,

  // Workaround for Node.js v20+ coverage issues
  workerIdleMemoryLimit: '512MB',
};
