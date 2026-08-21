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
    // Test infrastructure, not production code under test.
    '!src/test-helpers/**',
    // Pure type declarations (interfaces only) — no runtime to cover.
    '!src/types/psp.ts',
  ],

  // Coverage floors lock in current coverage so it cannot silently regress.
  //
  // Jest subtracts any file with its own path-specific threshold from the
  // `global` pool. `global` is therefore the floor for the remaining DOM and
  // async entry/service modules. The modules listed below are held to their own
  // higher individual bars.
  //
  // Per-file `functions` floors keep extra slack: function coverage is
  // count-coarse, so one uncovered function in a small file shifts it by points.
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 88,
      functions: 98,
      lines: 95,
    },
    './src/lib/history.ts': {
      statements: 92,
      branches: 86,
      functions: 98,
      lines: 92,
    },
    './src/lib/utilities.ts': {
      statements: 98,
      branches: 90,
      functions: 98,
      lines: 98,
    },
    './src/options-core.ts': {
      statements: 98,
      branches: 98,
      functions: 98,
      lines: 98,
    },
    './src/options.ts': {
      statements: 95,
      branches: 80,
      functions: 98,
      lines: 95,
    },
    './src/services/psp-detector.ts': {
      statements: 95,
      branches: 87,
      functions: 98,
      lines: 95,
    },
    './src/services/telemetry.ts': {
      statements: 99,
      branches: 95,
      functions: 98,
      lines: 99,
    },
  },

  // Coverage reporter configuration
  coverageReporters: ['text', 'text-summary', 'lcov'],
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
