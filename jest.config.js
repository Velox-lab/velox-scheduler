/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // @stellar/stellar-sdk depends on ESM-only packages. Node loads them natively,
  // but Jest's module system needs them transpiled to CommonJS.
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true }, isolatedModules: true }],
  },
  transformIgnorePatterns: ['node_modules/(?!(uint8array-extras|@exodus/bytes|@noble)/)'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};
