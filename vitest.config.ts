import { defineConfig } from "vitest/config";
import path from "node:path";

// Tests always run against a dedicated SQLite file (test.db), never the
// dev.db used by `npm run dev` — real Prisma queries hit this DB (no
// mocking), so constraint behavior like unique-subdomain/email violations
// is exercised for real. Schema is pushed to it via the `pretest` script.
process.env.DATABASE_URL = "file:./test.db";
(process.env as { NODE_ENV: string }).NODE_ENV = "test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // All DB-backed test files share one SQLite file (test.db); running
    // them in parallel worker threads causes cross-file interference
    // (one file's afterEach cleanup racing another file's assertions).
    // Force serial execution across files instead of sharding a DB per
    // worker, which isn't worth the setup cost for this suite's size.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
