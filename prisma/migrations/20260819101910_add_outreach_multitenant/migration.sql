-- AlterTable
ALTER TABLE "error_logs" ADD COLUMN     "isExpected" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "outreach_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "platform_handles" TEXT NOT NULL DEFAULT '{}',
    "run_time" TEXT NOT NULL DEFAULT '09:00',
    "ig_daily_limit" INTEGER NOT NULL DEFAULT 20,
    "linkedin_daily_limit" INTEGER NOT NULL DEFAULT 30,
    "proxy_host" TEXT,
    "proxy_port" TEXT,
    "proxy_username" TEXT,
    "proxy_password_enc" TEXT,
    "warmup_current_limit" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'active',
    "warning_type" TEXT,
    "warning_reason" TEXT,
    "redistribute_flag" BOOLEAN NOT NULL DEFAULT false,
    "last_active_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "target_niche" TEXT NOT NULL DEFAULT '',
    "target_industry" TEXT NOT NULL DEFAULT '',
    "target_location" TEXT NOT NULL DEFAULT '',
    "target_business_type" TEXT NOT NULL DEFAULT '',
    "outreach_languages" TEXT NOT NULL DEFAULT '["English"]',
    "message_style" TEXT NOT NULL DEFAULT 'discovery',
    "style_duration_days" INTEGER NOT NULL DEFAULT 7,
    "style_last_rotated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "default_recontact_gap_days" INTEGER NOT NULL DEFAULT 30,
    "max_contacts_per_lead" INTEGER NOT NULL DEFAULT 2,
    "whatsapp_recipient_1" TEXT,
    "whatsapp_recipient_2" TEXT,
    "approval_required" BOOLEAN NOT NULL DEFAULT true,
    "approval_reminder_hours" INTEGER NOT NULL DEFAULT 24,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_leads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT,
    "platform" TEXT NOT NULL,
    "business_name" TEXT,
    "profile_url" TEXT,
    "profile_photo_url" TEXT,
    "follower_count" INTEGER,
    "industry" TEXT,
    "website" TEXT,
    "social_platforms" TEXT NOT NULL DEFAULT '[]',
    "company_size" TEXT,
    "revenue_tier" TEXT,
    "ads_running" BOOLEAN,
    "weak_points" TEXT NOT NULL DEFAULT '[]',
    "ai_opportunities" TEXT NOT NULL DEFAULT '[]',
    "founder_found" BOOLEAN NOT NULL DEFAULT false,
    "founder_name" TEXT,
    "founder_source_phrase" TEXT,
    "whatsapp_found" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp_number" TEXT,
    "score" INTEGER,
    "temperature" TEXT,
    "score_reasoning" TEXT,
    "generated_message" TEXT,
    "message_style_used" TEXT,
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "contact_count" INTEGER NOT NULL DEFAULT 0,
    "first_contacted_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_followup" BOOLEAN NOT NULL DEFAULT false,
    "is_reengagement" BOOLEAN NOT NULL DEFAULT false,
    "approval_status" TEXT NOT NULL DEFAULT 'awaiting',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "edited_body" TEXT,
    "hold_reason" TEXT,
    "send_status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "sent_via_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_pipeline_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "from_stage" TEXT,
    "to_stage" TEXT NOT NULL,
    "changed_by" TEXT NOT NULL DEFAULT 'agent',
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_pipeline_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_follow_ups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduled_for" TIMESTAMP(3),
    "is_reengagement" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_client_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "business_name" TEXT,
    "platform" TEXT,
    "industry" TEXT,
    "score" INTEGER,
    "temperature" TEXT,
    "weak_points" TEXT,
    "founder_found" BOOLEAN,
    "founder_name" TEXT,
    "contacted" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" TEXT,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_client_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_notifications_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "body" TEXT,
    "related_lead_id" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_notifications_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "leads_found" INTEGER NOT NULL DEFAULT 0,
    "messages_sent" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "notes" TEXT,
    "skipped_leads" TEXT,

    CONSTRAINT "outreach_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_replies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "account_id" TEXT,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "replied_at" TIMESTAMP(3) NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outreach_accounts_tenant_id_idx" ON "outreach_accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_accounts_tenant_id_status_idx" ON "outreach_accounts"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_settings_tenant_id_key" ON "outreach_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_leads_tenant_id_idx" ON "outreach_leads"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_leads_tenant_id_status_idx" ON "outreach_leads"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "outreach_leads_tenant_id_created_at_idx" ON "outreach_leads"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "outreach_leads_tenant_id_score_idx" ON "outreach_leads"("tenant_id", "score");

-- CreateIndex
CREATE INDEX "outreach_leads_tenant_id_updated_at_idx" ON "outreach_leads"("tenant_id", "updated_at");

-- CreateIndex
CREATE INDEX "outreach_leads_tenant_id_account_id_created_at_idx" ON "outreach_leads"("tenant_id", "account_id", "created_at");

-- CreateIndex
CREATE INDEX "outreach_leads_tenant_id_whatsapp_found_idx" ON "outreach_leads"("tenant_id", "whatsapp_found");

-- CreateIndex
CREATE INDEX "outreach_leads_tenant_id_profile_url_idx" ON "outreach_leads"("tenant_id", "profile_url");

-- CreateIndex
CREATE INDEX "outreach_leads_tenant_id_platform_idx" ON "outreach_leads"("tenant_id", "platform");

-- CreateIndex
CREATE INDEX "outreach_messages_tenant_id_idx" ON "outreach_messages"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_messages_tenant_id_lead_id_idx" ON "outreach_messages"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "outreach_messages_tenant_id_approval_status_idx" ON "outreach_messages"("tenant_id", "approval_status");

-- CreateIndex
CREATE INDEX "outreach_messages_tenant_id_approval_status_send_status_idx" ON "outreach_messages"("tenant_id", "approval_status", "send_status");

-- CreateIndex
CREATE INDEX "outreach_pipeline_history_tenant_id_idx" ON "outreach_pipeline_history"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_pipeline_history_lead_id_changed_at_idx" ON "outreach_pipeline_history"("lead_id", "changed_at");

-- CreateIndex
CREATE INDEX "outreach_follow_ups_tenant_id_idx" ON "outreach_follow_ups"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_follow_ups_tenant_id_enabled_status_scheduled_for_idx" ON "outreach_follow_ups"("tenant_id", "enabled", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "outreach_client_history_tenant_id_idx" ON "outreach_client_history"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_client_history_tenant_id_analyzed_at_idx" ON "outreach_client_history"("tenant_id", "analyzed_at");

-- CreateIndex
CREATE INDEX "outreach_notifications_log_tenant_id_idx" ON "outreach_notifications_log"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_runs_tenant_id_idx" ON "outreach_runs"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_runs_tenant_id_started_at_idx" ON "outreach_runs"("tenant_id", "started_at");

-- CreateIndex
CREATE INDEX "outreach_runs_account_id_started_at_idx" ON "outreach_runs"("account_id", "started_at");

-- CreateIndex
CREATE INDEX "outreach_replies_tenant_id_idx" ON "outreach_replies"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_replies_lead_id_replied_at_idx" ON "outreach_replies"("lead_id", "replied_at");

-- AddForeignKey
ALTER TABLE "outreach_accounts" ADD CONSTRAINT "outreach_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_settings" ADD CONSTRAINT "outreach_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "outreach_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "outreach_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_sent_via_account_id_fkey" FOREIGN KEY ("sent_via_account_id") REFERENCES "outreach_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_pipeline_history" ADD CONSTRAINT "outreach_pipeline_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_pipeline_history" ADD CONSTRAINT "outreach_pipeline_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "outreach_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_follow_ups" ADD CONSTRAINT "outreach_follow_ups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_follow_ups" ADD CONSTRAINT "outreach_follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "outreach_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_client_history" ADD CONSTRAINT "outreach_client_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_client_history" ADD CONSTRAINT "outreach_client_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "outreach_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_notifications_log" ADD CONSTRAINT "outreach_notifications_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_notifications_log" ADD CONSTRAINT "outreach_notifications_log_related_lead_id_fkey" FOREIGN KEY ("related_lead_id") REFERENCES "outreach_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_runs" ADD CONSTRAINT "outreach_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_runs" ADD CONSTRAINT "outreach_runs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "outreach_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_replies" ADD CONSTRAINT "outreach_replies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_replies" ADD CONSTRAINT "outreach_replies_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "outreach_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
