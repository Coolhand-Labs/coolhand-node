module.exports = {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'ES2020',
        target: 'ES2020',
        lib: ['ES2020']
      }
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  coverageThreshold: {
    global: {
      lines: 50,
      functions: 45,
      branches: 40,
      statements: 50
    }
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
};