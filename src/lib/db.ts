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

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

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
