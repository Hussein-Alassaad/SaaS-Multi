import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // outreach/ is a separate standalone project (Python agent + its own
    // legacy Vite/React dashboard, own package.json/node_modules/dist) that
    // happens to live in this repo -- not part of this Next.js app, and its
    // dashboard alone was flooding `npm run lint` with ~12.8k problems from
    // an entirely different lint setup.
    "outreach/**",
    // chrome-extension/ is a separate deployable artifact (a Chrome
    // extension, loaded by the browser directly, no build step) -- same
    // reasoning as outreach/ above, not part of this Next.js app's TS/React
    // lint scope.
    "chrome-extension/**",
  ]),
]);

export default eslintConfig;
