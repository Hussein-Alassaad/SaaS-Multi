"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function setUiLanguageAction(lang: "EN" | "AR") {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };

  await db.user.update({
    where: { id: session.id },
    data: { uiLanguage: lang },
  });

  revalidatePath("/agency", "layout");
  return { ok: true as const };
}
