import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Tests run against a dedicated `test` Postgres schema (a separate
// namespace within the same database dev/prod use, not a second
// database/project), never the `public` schema real seeded data lives in —
// real Prisma queries hit this schema (no mocking), so constraint behavior
// like unique-subdomain/email violations is exercised for real. Schema is
// pushed to it via the `pretest` script (scripts/push-test-db.mjs), which
// derives the same URL from DATABASE_URL the same way this file does.
loadEnv();
// Tests MUST use the session-mode connection (DIRECT_DATABASE_URL, port 5432), never the transaction pooler (DATABASE_URL,
// port 6543). Prisma sets search_path=test on each connection it opens; behind the transaction pooler that connection is
// shared with everything else, so after a test run other clients (the outreach agent's SQL, which does not qualify table
// names) kept landing in the empty `test` schema -- "relation does not exist" / foreign-key errors in production
// (seen 2026-10-12/13 during discovery). Session mode gives each test client its own server connection.
if (!process.env.DIRECT_DATABASE_URL) {
  throw new Error("DIRECT_DATABASE_URL is not set (checked .env) -- tests need the session-mode Postgres connection string.");
}
const testDbUrl = new URL(process.env.DIRECT_DATABASE_URL);
testDbUrl.searchParams.set("schema", "test");
process.env.DATABASE_URL = testDbUrl.toString();
(process.env as { NODE_ENV: string }).NODE_ENV = "test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // All DB-backed test files share one Postgres schema (`test`); running
    // them in parallel worker threads causes cross-file interference
    // (one file's afterEach cleanup racing another file's assertions).
    // Force serial execution across files instead of sharding a schema per
    // worker, which isn't worth the setup cost for this suite's size.
    fileParallelism: false,
    // Default 5000ms was tuned for local SQLite; tests now make real
    // network round-trips (remote Postgres via Supabase's pooler, and
    // some tests also call the real Upstash Redis rate limiter) so a
    // test doing several DB calls plus a rate-limit check can legitimately
    // take longer than that.
    testTimeout: 15_000,
    // Same reasoning as testTimeout above, for beforeEach/afterEach hooks --
    // which Vitest times separately, and which kept the 10s default. The
    // DB-backed suites' beforeEach seeds a full fixture set (product, plan,
    // and every role with its permission rows) one INSERT at a time; against
    // the remote pooler that measures 9-10s, i.e. right on the old default,
    // so those hooks failed intermittently with "Hook timed out in 10000ms"
    // rather than for any behavioral reason.
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
