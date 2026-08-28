"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";

export async function submitFeatureRequestAction(input: { title: string; description: string }) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "feature-requests", "create");
  if (!permCheck.ok) return permCheck;

  if (!input.title.trim() || !input.description.trim()) {
    return { ok: false as const, error: "Title and description are required." };
  }

  await withTenant(session.tenantId!, (tx) =>
    tx.tenantFeatureRequest.create({
      data: {
        tenantId: session.tenantId!,
        title: input.title.trim(),
        description: input.description.trim(),
        filedById: session.id,
      },
    })
  );

  revalidatePath("/agency/feature-requests");
  return { ok: true as const };
}
