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

  // Coverage configuration - disabled due to Node.js v24 compatibility issues
  collectCoverage: false,
  collectCoverageFrom: [],

  // Coverage reporter configuration
  coverageReporters: ['text', 'text-summary'],

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
