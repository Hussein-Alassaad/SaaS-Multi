"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { FEATURE_REQUEST_STATUSES } from "@/lib/mock/feature-requests";

export async function updateFeatureRequestStatusAction(
  requestId: string,
  status: (typeof FEATURE_REQUEST_STATUSES)[number]
) {
  const admin = await getSession();
  if (!admin) return { ok: false as const, error: "Not authenticated." };
  guard(admin.role?.name ?? "", "feature-requests", "edit");

  const existing = await db.tenantFeatureRequest.findUnique({ where: { id: requestId } });
  if (!existing) return { ok: false as const, error: "Request not found." };

  await db.tenantFeatureRequest.update({
    where: { id: requestId },
    data: { status },
  });

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: "feature_request.status_changed",
      resource: "feature-requests",
      tenantId: existing.tenantId,
      oldValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({ status }),
      device: "Desktop",
      browser: "Admin Console",
    },
  });

  revalidatePath("/admin/feature-requests");
  return { ok: true as const };
}
