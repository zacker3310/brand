import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next*/**", "node_modules/**", ".cache/**", "drizzle/**", "playwright-report/**", "test-results/**", "next-env.d.ts",
      // Verbatim third-party source snapshots used as parser fixtures; not our code.
      "tests/fixtures/**/*.js", "tests/fixtures/**/*.mjs", "tests/fixtures/**/*.cjs"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];

export default config;
