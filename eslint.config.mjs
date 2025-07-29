import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  // Ignore patterns
  {
    ignores: ["dist/**", "node_modules/**"],
  },

  // Base configurations
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // General settings for all files
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.webextensions,
      },
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "error",
    },
  },

  // Node.js build files
  {
    files: ["build.js", "jest.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-undef": "off",
    },
  },

  // TypeScript source files
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];
