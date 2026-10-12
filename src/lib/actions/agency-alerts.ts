"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { countUnreadAlerts, getRecentAlerts } from "@/lib/agency/alerts";

export interface AlertDto {
  id: string;
  type: string;
  title: string;
  body: string;
  conversationId: string | null;
  read: boolean;
  createdAt: string;
}

/** Feeds the bell in the agency layout. Any signed-in member of the tenant may read their tenant's alerts. */
export async function getAlertsAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };

  const [alerts, unread] = await Promise.all([getRecentAlerts(session.tenantId!, 30), countUnreadAlerts(session.tenantId!)]);
  return {
    ok: true as const,
    unread,
    alerts: alerts.map<AlertDto>((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      body: a.body,
      conversationId: a.conversationId,
      read: a.readAt !== null,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function markAlertReadAction(alertId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  await withTenant(session.tenantId!, (tx) =>
    tx.tenantAlert.updateMany({ where: { id: alertId, tenantId: session.tenantId!, readAt: null }, data: { readAt: new Date() } })
  );
  return { ok: true as const };
}

export async function markAllAlertsReadAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  await withTenant(session.tenantId!, (tx) =>
    tx.tenantAlert.updateMany({ where: { tenantId: session.tenantId!, readAt: null }, data: { readAt: new Date() } })
  );
  return { ok: true as const };
}
