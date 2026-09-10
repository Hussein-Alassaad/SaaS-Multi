"use server";

import { randomBytes, createHash } from "crypto";
import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { logError } from "@/lib/error-log";
import { revalidatePath } from "next/cache";

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function listApiKeysAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "api-keys", "view");
  if (!permCheck.ok) return permCheck;

  const keys = await withTenant(session.tenantId!, (tx) =>
    tx.tenantApiKey.findMany({
      where: { tenantId: session.tenantId!, revokedAt: null },
      orderBy: { createdAt: "desc" },
    })
  );

  return {
    ok: true as const,
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPreview: `mk_live_••••${k.keyPreview}`,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    })),
  };
}

export async function generateApiKeyAction(name: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "api-keys", "edit");
  if (!permCheck.ok) return permCheck;

  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false as const, error: "Name is required." };

  const rawKey = `mk_live_${randomBytes(24).toString("base64url")}`;

  try {
    await withTenant(session.tenantId!, async (tx) => {
      await tx.tenantApiKey.create({
        data: {
          tenantId: session.tenantId!,
          name: trimmedName,
          keyHash: hashApiKey(rawKey),
          keyPreview: rawKey.slice(-4),
          createdById: session.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: session.id,
          action: "tenant_api_key.created",
          resource: "api-keys",
          tenantId: session.tenantId,
          newValue: JSON.stringify({ name: trimmedName }),
          device: "Desktop",
          browser: "Agency OS",
        },
      });
    });
  } catch (err) {
    await logError({ source: "marketing_api_keys.create", error: err, context: { tenantId: session.tenantId, name: trimmedName } });
    return { ok: false as const, error: "Failed to create API key. Please try again." };
  }

  revalidatePath("/agency/api-keys");
  // The only time the real key is ever returned -- callers must show this
  // to the tenant immediately and cannot retrieve it again afterward.
  return { ok: true as const, rawKey };
}

export async function revokeApiKeyAction(keyId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "api-keys", "edit");
  if (!permCheck.ok) return permCheck;

  const revoked = await withTenant(session.tenantId!, async (tx) => {
    const key = await tx.tenantApiKey.findFirst({ where: { id: keyId, tenantId: session.tenantId! } });
    if (!key) return false;

    await tx.tenantApiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });

    await tx.auditLog.create({
      data: {
        actorId: session.id,
        action: "tenant_api_key.revoked",
        resource: "api-keys",
        tenantId: session.tenantId,
        newValue: JSON.stringify({ keyId }),
        device: "Desktop",
        browser: "Agency OS",
      },
    });

    return true;
  });

  if (!revoked) return { ok: false as const, error: "API key not found." };

  revalidatePath("/agency/api-keys");
  return { ok: true as const };
}
