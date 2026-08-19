// Pushes the current Prisma schema to a dedicated `test` Postgres schema
// (not a separate database/project -- Postgres schemas are logically
// separate namespaces within one database) before the test suite runs.
// Runs as npm's `pretest` hook. Keeps test runs fully isolated from real
// seeded data in the `public` schema without needing a second Supabase
// project. Requires DATABASE_URL to already be set (real Postgres/Supabase
// connection string); this just appends/overrides the ?schema= param.
import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

loadEnv();
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  console.error("DATABASE_URL is not set -- cannot derive a test schema URL.");
  process.exit(1);
}

const testUrl = new URL(baseUrl);
testUrl.searchParams.set("schema", "test");

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testUrl.toString() },
});
