-- Marks that the 1-hour-before reminder for a confirmed meeting was handled.
ALTER TABLE "meeting_requests" ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3);
