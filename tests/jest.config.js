/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 30000,
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  // Run tests sequentially to avoid port/state conflicts
  maxWorkers: 1,
};
