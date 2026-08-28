-- Row-Level Security for every per-tenant business-data table.
-- Defense-in-depth on top of the existing app-level `tenantId: session.tenantId`
-- checks (which stay in place, unchanged) -- even a future query that forgets
-- to filter by tenant can no longer leak another tenant's rows, because
-- Postgres itself refuses to return them.
--
-- Access model, set per-request via src/lib/db.ts's withTenant()/withPlatformAccess()
-- helpers using SET LOCAL inside a transaction (safe with Supabase's pgbouncer
-- transaction-pooling -- SET LOCAL is scoped to the transaction only, so it
-- can never leak across pooled connections onto a different tenant's query):
--   app.current_tenant_id  -- the logged-in tenant's own id (TENANT-scope sessions)
--   app.is_platform_admin  -- 'true' for PLATFORM-scope (Admin) sessions, which
--                              legitimately need to read/write ANY tenant's data
--
-- NOT touched here (deliberately excluded, see this session's own design notes):
--   users, roles, permissions, products, plans -- platform-wide or needed for
--   the login lookup itself (which happens before any tenant is known)
--   audit_logs, error_logs -- nullable tenant_id (some rows are platform-level
--   with no tenant at all), handled by a separate, more permissive policy below

-- NOTE ON COLUMN NAMING: this database uses two different spellings for the
-- tenant column. The Prisma-managed tables use camelCase "tenantId" (quoted,
-- because Postgres folds unquoted identifiers to lowercase), while the
-- outreach_* tables -- created outside Prisma by the Python agent -- use
-- snake_case tenant_id. Rather than hardcode either spelling, each policy
-- below looks the real column up in the catalog, so this migration stays
-- correct for both families and fails loudly if a table has neither.

-- ── Tables with a NOT NULL tenant id: strict "own tenant OR platform admin" ──
DO $$
DECLARE
  t text;
  col text;
  tables text[] := ARRAY[
    'subscriptions', 'invoices', 'payments', 'refunds', 'ai_usage_logs',
    'support_tickets', 'impersonation_sessions', 'team_invites', 'channels',
    'nexaris_clients', 'conversations', 'meeting_slots', 'meeting_requests',
    'knowledge_entries', 'tenant_feature_requests', 'ai_settings',
    'outreach_accounts', 'outreach_settings', 'outreach_leads', 'outreach_messages',
    'outreach_pipeline_history', 'outreach_follow_ups', 'outreach_client_history',
    'outreach_notifications_log', 'outreach_runs', 'outreach_replies'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    SELECT column_name INTO col
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t
       AND column_name IN ('tenant_id', 'tenantId');

    IF col IS NULL THEN
      RAISE EXCEPTION 'table % has no tenant_id/tenantId column', t;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t); -- applies even to the table owner role
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (
         %I = current_setting(''app.current_tenant_id'', true)
         OR current_setting(''app.is_platform_admin'', true) = ''true''
       ) WITH CHECK (
         %I = current_setting(''app.current_tenant_id'', true)
         OR current_setting(''app.is_platform_admin'', true) = ''true''
       )', t, col, col
    );
  END LOOP;
END $$;

-- ── audit_logs / error_logs: nullable tenantId, some rows are platform-level ──
-- Both are Prisma-managed, so the column is camelCase and must stay quoted.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_logs;
CREATE POLICY tenant_isolation ON audit_logs USING (
  "tenantId" IS NULL
  OR "tenantId" = current_setting('app.current_tenant_id', true)
  OR current_setting('app.is_platform_admin', true) = 'true'
) WITH CHECK (
  "tenantId" IS NULL
  OR "tenantId" = current_setting('app.current_tenant_id', true)
  OR current_setting('app.is_platform_admin', true) = 'true'
);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON error_logs;
CREATE POLICY tenant_isolation ON error_logs USING (
  "tenantId" IS NULL
  OR "tenantId" = current_setting('app.current_tenant_id', true)
  OR current_setting('app.is_platform_admin', true) = 'true'
) WITH CHECK (
  "tenantId" IS NULL
  OR "tenantId" = current_setting('app.current_tenant_id', true)
  OR current_setting('app.is_platform_admin', true) = 'true'
);
