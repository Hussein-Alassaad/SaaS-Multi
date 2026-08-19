"use client";

import { useEffect } from "react";
import { getSupabaseRealtimeClient } from "@/lib/outreach/supabase-realtime";
import { useToast } from "@/components/ui/Toast";

/**
 * Two app-wide realtime listeners, mounted once in the Outreach layout (not
 * per-page): a hot-lead/WhatsApp-found toast watching outreach_leads, and
 * an error toast watching the shared error_logs table filtered to this
 * tenant + Outreach's own error sources. Both fire regardless of which
 * Outreach page is currently open.
 */
export function OutreachRealtimeToasts({ tenantId }: { tenantId: string }) {
  const { showToast } = useToast();

  useEffect(() => {
    const supabase = getSupabaseRealtimeClient();

    const leadsChannel = supabase
      .channel(`outreach:leads-toast:${tenantId}`)
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "outreach_leads", filter: `tenant_id=eq.${tenantId}` },
        (payload: { new?: Record<string, unknown> }) => {
          const row = payload.new;
          if (!row) return;
          if (row.temperature === "hot") {
            showToast({
              variant: "success",
              title: "Hot lead found",
              description: typeof row.business_name === "string" ? row.business_name : undefined,
            });
          } else if (row.whatsapp_found === true) {
            showToast({
              variant: "default",
              title: "WhatsApp number found",
              description: typeof row.business_name === "string" ? row.business_name : undefined,
            });
          }
        }
      );
    const leadsRaf = requestAnimationFrame(() => leadsChannel.subscribe());

    const errorsChannel = supabase
      .channel(`outreach:errors-toast:${tenantId}`)
      .on(
        "postgres_changes" as never,
        { event: "INSERT", schema: "public", table: "error_logs", filter: `tenant_id=eq.${tenantId}` },
        (payload: { new?: Record<string, unknown> }) => {
          const row = payload.new;
          if (!row) return;
          // Supabase Realtime's filter syntax supports only one
          // column-operator-value triple, so "source LIKE 'outreach.%'"
          // isn't expressible server-side -- tenant scoping already
          // happened above; this client-side check just avoids toasting
          // on this tenant's non-Outreach errors (Marketing errors etc.).
          if (typeof row.source !== "string" || !row.source.startsWith("outreach.")) return;
          if (row.is_expected === true) return;
          showToast({
            variant: "error",
            title: "Outreach error",
            description: typeof row.message === "string" ? row.message : undefined,
          });
        }
      );
    const errorsRaf = requestAnimationFrame(() => errorsChannel.subscribe());

    return () => {
      cancelAnimationFrame(leadsRaf);
      cancelAnimationFrame(errorsRaf);
      supabase.removeChannel(leadsChannel);
      supabase.removeChannel(errorsChannel);
    };
  }, [tenantId, showToast]);

  return null;
}
