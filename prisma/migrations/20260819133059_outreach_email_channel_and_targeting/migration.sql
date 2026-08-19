-- AlterTable
ALTER TABLE "outreach_accounts" ADD COLUMN     "email_daily_limit" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "platform" TEXT NOT NULL DEFAULT 'linkedin',
ADD COLUMN     "ses_from_email" TEXT,
ADD COLUMN     "ses_from_name" TEXT;

-- AlterTable
ALTER TABLE "outreach_settings" ADD COLUMN     "target_company_size_max" INTEGER,
ADD COLUMN     "target_company_size_min" INTEGER,
ADD COLUMN     "target_needs" TEXT NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "outreach_accounts_tenant_id_platform_idx" ON "outreach_accounts"("tenant_id", "platform");
