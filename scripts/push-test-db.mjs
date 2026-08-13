// Pushes the current Prisma schema to the dedicated test SQLite database
// (test.db) before the test suite runs. Runs as npm's `pretest` hook.
import { execSync } from "node:child_process";

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: "file:./test.db" },
});
