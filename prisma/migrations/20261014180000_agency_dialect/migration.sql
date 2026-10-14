-- Which Arabic dialect the AI answers in when the customer wording is ambiguous.
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "dialect" TEXT NOT NULL DEFAULT 'AUTO';
