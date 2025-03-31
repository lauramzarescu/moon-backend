module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/src/**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js', 'json', 'node'],
    collectCoverage: true,
    collectCoverageFrom: ['src/**/*.{ts,js}', '!src/**/*.d.ts'],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
};