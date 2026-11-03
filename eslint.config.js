import eslint from "@eslint/js";
import jsdoc from "eslint-plugin-jsdoc";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  jsdoc.configs["flat/recommended"],
  prettier,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "jsdoc/no-undefined-types": 0,
      "jsdoc/reject-function-type": 0,
      "jsdoc/tag-lines": ["error", "any", { startLines: 1 }],
      "no-new-func": "error",
      "no-eval": "error",
      "no-return-await": "error",
      "@typescript-eslint/await-thenable": "error",
      "require-await": "error",
    },
  },
);
