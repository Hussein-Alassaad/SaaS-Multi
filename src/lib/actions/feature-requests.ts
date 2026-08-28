"use server";

import { withPlatformAccess } from "@/lib/db";
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

  const found = await withPlatformAccess(async (tx) => {
    const existing = await tx.tenantFeatureRequest.findUnique({ where: { id: requestId } });
    if (!existing) return false;

    await tx.tenantFeatureRequest.update({
      where: { id: requestId },
      data: { status },
    });

    await tx.auditLog.create({
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
    return true;
  });
  if (!found) return { ok: false as const, error: "Request not found." };

  revalidatePath("/admin/feature-requests");
  return { ok: true as const };
}
