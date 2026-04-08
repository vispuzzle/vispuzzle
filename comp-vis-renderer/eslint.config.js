const prettierPlugin = require("eslint-plugin-prettier");
module.exports = [{
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: {
      browser: "readonly",
      es2021: "readonly",
      node: "readonly"
    }
  },
  rules: {
    "prefer-const": "warn",
    "no-unused-vars": ["warn", {
      varsIgnorePattern: "^_"
    }],
    eqeqeq: "error",
    "no-var": "error",
    "prefer-arrow-callback": "warn",
    "prettier/prettier": "error"
  },
  plugins: {
    prettier: prettierPlugin
  }
}];