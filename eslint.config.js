// eslint.config.js
module.exports = [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        // Define the environments you're using
        browser: true, // Browser globals like `window`, `document`
        node: true,    // Node.js globals like `process`
        es6: true,     // ECMAScript 6 features
      },
    },
    rules: {
      "semi": ["error", "always"],
      "quotes": ["error", "double"],
      "indent": ["error", 2],
      "no-console": "warn",
    },
  },
];
  