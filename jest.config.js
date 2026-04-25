/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/control-plane/**/*.test.js'],
    testPathIgnorePatterns: ['/node_modules/', '/release/', '/dist/'],
};
