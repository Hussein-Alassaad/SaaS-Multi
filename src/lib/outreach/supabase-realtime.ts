"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client used EXCLUSIVELY for Realtime channel
 * subscriptions (Outreach's live-update pages). All actual data reads and
 * writes stay on the Prisma + Server Actions/Server Components path --
 * this client never queries or mutates a table directly, only listens for
 * postgres_changes broadcasts. Only the anon key is used here; the service
 * role key never reaches the browser.
 */
let client: SupabaseClient | null = null;

export function getSupabaseRealtimeClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.");
  }
  client = createClient(url, anonKey, {
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return client;
}
