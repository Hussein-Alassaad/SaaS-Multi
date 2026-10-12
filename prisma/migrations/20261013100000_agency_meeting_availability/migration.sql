-- Working-hours based meeting slot generation (see AiSettings in schema.prisma).
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "meetingAutoSlots" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "meetingDays" TEXT NOT NULL DEFAULT '1,2,3,4,5';
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "meetingStartHour" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "meetingEndHour" INTEGER NOT NULL DEFAULT 17;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "meetingDurationMin" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "meetingHorizonDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "meetingSlotsThrough" TIMESTAMP(3);
