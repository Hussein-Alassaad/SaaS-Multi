"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

export async function setProductMaintenanceModeAction(productId: string, enabled: boolean) {
  const admin = await getSession();
  if (!admin) return { ok: false as const, error: "Not authenticated." };
  guard(admin.role?.name ?? "", "products", "edit");

  const existing = await db.product.findUnique({ where: { id: productId } });
  if (!existing) return { ok: false as const, error: "Product not found." };

  await db.product.update({
    where: { id: productId },
    data: { maintenanceMode: enabled },
  });

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: enabled ? "product.maintenance.enabled" : "product.maintenance.disabled",
      resource: "products",
      oldValue: JSON.stringify({ maintenanceMode: existing.maintenanceMode }),
      newValue: JSON.stringify({ maintenanceMode: enabled, productId }),
      device: "Desktop",
      browser: "Admin Console",
    },
  });

  revalidatePath(`/admin/products/${existing.slug}`);
  revalidatePath("/admin/products");
  return { ok: true as const };
}
