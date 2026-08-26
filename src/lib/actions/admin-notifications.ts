"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { saveUploadedFile } from "@/lib/storage";
import { revalidatePath } from "next/cache";

export interface CreateNotificationInput {
  title: string;
  body: string;
  audience: "ALL_TENANTS" | "PRODUCT_TENANTS" | "SPECIFIC_TENANT" | "ALL_PLATFORM_USERS";
  audienceRef?: string | null; // productId or tenantId, depending on audience
  scheduledAt?: string | null; // ISO string, optional
  image?: File | null;
}

/**
 * Creates a real Notification row -- the "New Broadcast" modal previously
 * only closed itself (local useState, no server call, nothing ever
 * persisted). `saveUploadedFile` is src/lib/storage.ts's local-disk upload
 * helper -- defined but never actually called anywhere before this, first
 * real caller here. Sending immediately (no scheduledAt) sets status
 * SENT + sentAt right away since there's no job runner in this app to act
 * on a future scheduledAt later -- see sendNow's own comment below.
 */
export async function createNotificationAction(input: CreateNotificationInput) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "notifications", "create");

  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) return { ok: false as const, error: "Title and message are required." };

  if (input.audience === "PRODUCT_TENANTS" || input.audience === "SPECIFIC_TENANT") {
    if (!input.audienceRef) {
      return { ok: false as const, error: "Select a target for this audience." };
    }
  }

  let imageUrl: string | null = null;
  if (input.image && input.image.size > 0) {
    if (!input.image.type.startsWith("image/")) {
      return { ok: false as const, error: "Attachment must be an image." };
    }
    const MAX_BYTES = 5 * 1024 * 1024; // 5MB -- generous for an announcement banner, not a media library
    if (input.image.size > MAX_BYTES) {
      return { ok: false as const, error: "Image must be under 5MB." };
    }
    const saved = await saveUploadedFile("platform-notifications", input.image);
    imageUrl = saved.filePath;
  }

  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  // Scheduling for later requires something to actually act on scheduledAt
  // when it arrives -- no job runner/cron exists in this app yet (same gap
  // noted elsewhere, e.g. src/app/api/cron/dispatch-pacing's own docstring).
  // A future scheduledAt is still recorded (status SCHEDULED) so the intent
  // isn't lost and the dashboard shows it correctly, but nothing will
  // flip it to SENT automatically until that's built -- flagged here
  // rather than silently pretending scheduling works end-to-end.
  const isScheduledForFuture = scheduledAt !== null && scheduledAt.getTime() > Date.now();

  const notification = await db.notification.create({
    data: {
      title,
      body,
      imageUrl,
      audience: input.audience,
      audienceRef: input.audienceRef || null,
      status: isScheduledForFuture ? "SCHEDULED" : "SENT",
      scheduledAt,
      sentAt: isScheduledForFuture ? null : new Date(),
    },
  });

  await db.auditLog.create({
    data: {
      actorId: session.id,
      action: "notification.created",
      resource: "notification",
      newValue: JSON.stringify({ title, audience: input.audience, audienceRef: input.audienceRef ?? null }),
      device: "Desktop",
      browser: "Admin",
    },
  });

  revalidatePath("/admin/notifications");
  revalidatePath("/agency");
  revalidatePath("/outreach");

  return { ok: true as const, notificationId: notification.id };
}

export async function cancelNotificationAction(notificationId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "notifications", "edit");

  const notification = await db.notification.findUnique({ where: { id: notificationId } });
  if (!notification) return { ok: false as const, error: "Notification not found." };
  if (notification.status === "SENT") return { ok: false as const, error: "This announcement was already sent." };

  await db.notification.update({ where: { id: notificationId }, data: { status: "CANCELED" } });

  revalidatePath("/admin/notifications");
  return { ok: true as const };
}

/**
 * Every product slug, for the "Product Tenants" audience picker -- the
 * Admin needs to choose WHICH product when targeting PRODUCT_TENANTS,
 * matching the real Product rows (marketing/gym/outreach), not a hardcoded
 * list.
 */
export async function getProductOptionsAction() {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "notifications", "view");

  const products = await db.product.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return { ok: true as const, products };
}

/** Every tenant, for the "Specific Tenant" audience picker. */
export async function getTenantOptionsAction() {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "notifications", "view");

  const tenants = await db.tenant.findMany({
    select: { id: true, companyName: true },
    orderBy: { companyName: "asc" },
  });
  return { ok: true as const, tenants };
}
