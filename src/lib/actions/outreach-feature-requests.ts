"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { revalidatePath } from "next/cache";

export async function submitOutreachFeatureRequestAction(input: { title: string; description: string }) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "feature-requests", "create");
  if (!permCheck.ok) return permCheck;

  if (!input.title.trim() || !input.description.trim()) {
    return { ok: false as const, error: "Title and description are required." };
  }

  await db.tenantFeatureRequest.create({
    data: {
      tenantId: session.tenantId!,
      title: input.title.trim(),
      description: input.description.trim(),
      filedById: session.id,
    },
  });

  revalidatePath("/outreach/feature-requests");
  return { ok: true as const };
}
