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

// schema.prisma's datasource sets a directUrl (env("DIRECT_DATABASE_URL")),
// which `prisma db push` actually connects with for DDL -- pgbouncer's
// transaction-pooling mode can't run the schema-introspection/DDL commands
// db push needs. Found 2026-09-10: this script only ever overrode
// DATABASE_URL, so every previous test run's "push to the test schema" was
// silently running against DIRECT_DATABASE_URL's own default schema
// (public, i.e. the real production schema) instead -- the test schema was
// never actually being kept in sync, and this was quietly pushing schema
// changes at prod on every test run. Both must point at ?schema=test.
const directBaseUrl = process.env.DIRECT_DATABASE_URL;
if (!directBaseUrl) {
  console.error("DIRECT_DATABASE_URL is not set -- cannot derive a test schema URL for it.");
  process.exit(1);
}
const testDirectUrl = new URL(directBaseUrl);
testDirectUrl.searchParams.set("schema", "test");

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: testUrl.toString(),
    DIRECT_DATABASE_URL: testDirectUrl.toString(),
  },
});
