-- Real WhatsApp / Instagram / Facebook channel support + in-platform admin alerts.
-- Additive only (nullable columns, one new table); every statement is idempotent,
-- so it is safe to apply by hand and again later through `prisma migrate deploy`.

ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "apiToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "channels_provider_externalId_key" ON "channels"("provider", "externalId");

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "externalContactId" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "aiPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastCustomerMessageAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "conversations_channelId_externalContactId_idx" ON "conversations"("channelId", "externalContactId");

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "messages_externalId_key" ON "messages"("externalId");

CREATE TABLE IF NOT EXISTS "tenant_alerts" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "conversationId" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tenant_alerts_tenantId_readAt_createdAt_idx" ON "tenant_alerts"("tenantId", "readAt", "createdAt");

DO $$ BEGIN
  ALTER TABLE "tenant_alerts" ADD CONSTRAINT "tenant_alerts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Row-level security, same policy shape as every other per-tenant table
-- (see prisma/migrations_manual/enable_rls.sql).
ALTER TABLE "tenant_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_alerts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_alerts";
CREATE POLICY tenant_isolation ON "tenant_alerts" USING (
  "tenantId" = current_setting('app.current_tenant_id', true)
  OR current_setting('app.is_platform_admin', true) = 'true'
) WITH CHECK (
  "tenantId" = current_setting('app.current_tenant_id', true)
  OR current_setting('app.is_platform_admin', true) = 'true'
);
