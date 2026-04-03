module.exports = {
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  testEnvironment: "node",
  setupFiles: ["<rootDir>/tests/setup.js"],
  collectCoverageFrom: [
    "lib/**/*.js",
    "handlers/**/*.js",
    "app.js",
    "!**/node_modules/**",
  ],
  coverageDirectory: "coverage",
};
