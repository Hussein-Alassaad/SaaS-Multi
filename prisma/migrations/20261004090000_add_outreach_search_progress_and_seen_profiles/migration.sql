-- CreateTable
CREATE TABLE "outreach_search_progress" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "search_term" TEXT NOT NULL,
    "last_page" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_search_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_seen_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "profile_key" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_seen_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_search_progress_account_id_search_term_key" ON "outreach_search_progress"("account_id", "search_term");

-- CreateIndex
CREATE INDEX "outreach_search_progress_tenant_id_idx" ON "outreach_search_progress"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_seen_profiles_tenant_id_platform_profile_key_key" ON "outreach_seen_profiles"("tenant_id", "platform", "profile_key");

-- CreateIndex
CREATE INDEX "outreach_seen_profiles_tenant_id_platform_seen_at_idx" ON "outreach_seen_profiles"("tenant_id", "platform", "seen_at");

-- AddForeignKey
ALTER TABLE "outreach_search_progress" ADD CONSTRAINT "outreach_search_progress_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_search_progress" ADD CONSTRAINT "outreach_search_progress_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "outreach_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_seen_profiles" ADD CONSTRAINT "outreach_seen_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
