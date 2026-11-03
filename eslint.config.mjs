import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * Module boundaries (see README "Project layout"). Each layer may only depend
 * inward: app -> server/client -> shared -> domain. Enforced here so a wrong
 * import fails CI instead of relying on review.
 */
const layer = (name) => ({ group: [`@/${name}`, `@/${name}/*`], message: `Do not import ${name}/ from this layer.` });

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "spike-out/**"]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            layer("server"),
            layer("client"),
            layer("shared"),
            layer("app"),
            { group: ["next", "next/*", "react", "react-dom", "server-only"], message: "domain/ is framework-free." },
            { group: ["node:*", "fs", "path"], message: "domain/ is pure: no I/O." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            layer("server"),
            layer("client"),
            layer("app"),
            { group: ["server-only"], message: "shared/ runs in the browser too." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            layer("server"),
            layer("app"),
            { group: ["server-only"], message: "client/ runs in the browser." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [layer("client"), layer("app")] }],
    },
  },
]);
