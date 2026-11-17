import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Rows from Postgres JSON columns (components, meta, payloads) are untyped by nature.
      "@typescript-eslint/no-explicit-any": "off",
      // Media comes from short-lived signed Storage URLs; next/image optimisation does not apply.
      "@next/next/no-img-element": "off",
      // Data loaders call setState after an await (not synchronously); the rule cannot tell them apart.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
