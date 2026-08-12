"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";

export async function createKnowledgeEntryAction(input: { title: string; category: string; body: string }) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "knowledge-base", "create");
  if (!permCheck.ok) return permCheck;

  if (!input.title.trim() || !input.body.trim()) {
    return { ok: false as const, error: "Title and content are required." };
  }

  await db.knowledgeEntry.create({
    data: {
      tenantId: session.tenantId!,
      title: input.title.trim(),
      category: input.category,
      body: input.body.trim(),
      addedById: session.id,
    },
  });

  revalidatePath("/agency/knowledge-base");
  return { ok: true as const };
}

export async function updateKnowledgeEntryAction(id: string, input: { title: string; category: string; body: string }) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "knowledge-base", "edit");
  if (!permCheck.ok) return permCheck;

  const entry = await db.knowledgeEntry.findFirst({ where: { id, tenantId: session.tenantId! } });
  if (!entry) return { ok: false as const, error: "Entry not found." };

  await db.knowledgeEntry.update({
    where: { id },
    data: { title: input.title.trim(), category: input.category, body: input.body.trim() },
  });

  revalidatePath("/agency/knowledge-base");
  return { ok: true as const };
}

export async function deleteKnowledgeEntryAction(id: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "knowledge-base", "delete");
  if (!permCheck.ok) return permCheck;

  const entry = await db.knowledgeEntry.findFirst({ where: { id, tenantId: session.tenantId! } });
  if (!entry) return { ok: false as const, error: "Entry not found." };

  await db.knowledgeEntry.delete({ where: { id } });

  revalidatePath("/agency/knowledge-base");
  return { ok: true as const };
}
