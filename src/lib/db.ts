import { PrismaClient, Prisma } from "@prisma/client";
import "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Cache on globalThis in EVERY environment, not just non-production. This
// was previously inverted (only cached outside production) -- the opposite
// of the standard Next.js/Prisma serverless pattern. On Vercel, a
// serverless function instance is reused ("warm") across multiple
// invocations, and globalThis persists across those warm invocations of
// the SAME instance (it does NOT persist across genuinely separate cold
// starts -- there's no way to avoid paying that cost once per fresh
// instance). Without caching, every module reload -- which on a
// serverless platform can mean far more often than intended -- created a
// brand new PrismaClient and, with it, a brand new connection pool from
// scratch, adding real, avoidable latency to page loads that had nothing
// to do with the actual query being run. The non-production skip
// historically existed to avoid Next's dev-mode hot-reload piling up
// connections across recompiles; genuinely irrelevant to whether this
// still helps in production, dev, or gets confused between the two --
// caching is unconditionally correct in both.
globalForPrisma.prisma = db;

/**
 * Row-Level Security context helpers -- see prisma/migrations_manual/enable_rls.sql
 * for the actual Postgres policies these unlock. Every tenant-scoped table has
 * RLS FORCEd on, so a query made through the plain `db` export above (with no
 * context set) returns nothing at all for those tables -- not a leak, a hard
 * lock. Callers MUST go through one of these two wrappers to read/write them.
 *
 * Uses SET LOCAL inside a real Prisma transaction, not a plain SET -- this
 * app runs on Supabase's pgbouncer transaction-pooling mode (see .env's
 * DATABASE_URL), where a "session" can be silently backed by a different
 * physical Postgres connection on every query. A plain SET would leak across
 * pooled connections onto a completely different tenant's query. SET LOCAL is
 * scoped to the enclosing transaction only and is automatically discarded the
 * instant that transaction ends -- since the tenant context and the actual
 * query are both inside the SAME transaction (guaranteed same physical
 * connection for its whole duration), this is safe under pooling.
 *
 * This does NOT replace the existing `tenantId: session.tenantId` filters
 * already in every server action -- those stay, unchanged, as the first line
 * of defense (and the only thing that decides WHICH tenant to pass in here).
 * RLS is the second, database-level backstop: even if a future query forgets
 * that filter, Postgres itself still won't return another tenant's rows.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

/**
 * For PLATFORM-scope (Admin) sessions, which legitimately need to read/write
 * ANY tenant's data -- e.g. the Tenant detail page, tenant creation, support
 * tools. Sets app.is_platform_admin='true', which every RLS policy above
 * treats as an unconditional pass, same effect as pre-RLS unrestricted access.
 * Never call this from a TENANT-scope session's code path.
 */
export async function withPlatformAccess<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
    return fn(tx);
  });
}
