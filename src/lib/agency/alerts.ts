/**
 * In-platform alerts for a tenant's own admins -- "a customer asked for a
 * meeting", "a customer needs a human", "a reply failed to send". Stored in
 * TenantAlert (not Notification, which is the platform broadcasting to
 * tenants) and shown by the bell in the agency layout.
 */

import type { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db";

export type AlertType = "MEETING_REQUESTED" | "NEEDS_ATTENTION" | "NEW_CONVERSATION" | "SEND_FAILED" | "AI_BUDGET";

export interface NewAlert {
  tenantId: string;
  type: AlertType;
  title: string;
  body: string;
  conversationId?: string | null;
}

/** For callers already holding a tenant-scoped transaction. */
export function createAlertIn(tx: Prisma.TransactionClient, alert: NewAlert) {
  return tx.tenantAlert.create({
    data: {
      tenantId: alert.tenantId,
      type: alert.type,
      title: alert.title.slice(0, 200),
      body: alert.body.slice(0, 1000),
      conversationId: alert.conversationId ?? null,
    },
  });
}

export function createAlert(alert: NewAlert) {
  return withTenant(alert.tenantId, (tx) => createAlertIn(tx, alert));
}

export async function getRecentAlerts(tenantId: string, limit = 30) {
  return withTenant(tenantId, (tx) =>
    tx.tenantAlert.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limit })
  );
}

export async function countUnreadAlerts(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.tenantAlert.count({ where: { tenantId, readAt: null } }));
}
