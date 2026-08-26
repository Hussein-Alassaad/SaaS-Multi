"use server";

import { randomBytes, createHash } from "crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { logError } from "@/lib/error-log";

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ---------------------------------------------------------------------------
// Security policy (MFA/SSO toggles) -- one singleton row.
// ---------------------------------------------------------------------------

export async function getSecurityPolicy() {
  const policy = await db.securityPolicy.findUnique({ where: { id: "singleton" } });
  return policy ?? { id: "singleton", mfaRequired: false, ssoEnforced: false, updatedAt: new Date() };
}

export async function updateSecurityPolicyAction(input: { mfaRequired: boolean; ssoEnforced: boolean }) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "security", "edit");

  await db.securityPolicy.upsert({
    where: { id: "singleton" },
    update: { mfaRequired: input.mfaRequired, ssoEnforced: input.ssoEnforced },
    create: { id: "singleton", mfaRequired: input.mfaRequired, ssoEnforced: input.ssoEnforced },
  });

  await db.auditLog.create({
    data: {
      actorId: session.id,
      action: "security_policy.updated",
      resource: "security_policy",
      newValue: JSON.stringify(input),
      device: "Desktop",
      browser: "Admin Console",
    },
  });

  revalidatePath("/admin/security");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Active sessions -- real UserSession rows (src/lib/auth.ts), platform-wide
// across every scope (PLATFORM admins AND every tenant/client user), not
// Admin-only -- per the explicit requirement this was built to.
// ---------------------------------------------------------------------------

export async function getActiveSessionsAction() {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "security", "view");

  const sessions = await db.userSession.findMany({
    where: { revokedAt: null },
    include: { user: { select: { id: true, name: true, email: true, scope: true } } },
    orderBy: { lastActiveAt: "desc" },
    take: 100, // a real cap -- this page is a human skimming a list, not a full audit export (that's AuditLog's job)
  });

  return {
    ok: true as const,
    sessions: sessions.map((s) => ({
      id: s.id,
      userName: s.user.name,
      userEmail: s.user.email,
      userScope: s.user.scope,
      device: s.device ?? "Unknown device",
      ip: s.ip ?? "Unknown",
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

/**
 * Revokes ANY user's session by id -- not just the caller's own. This is a
 * platform-owner admin tool (guarded by "security"/"edit", same as the
 * rest of this file), the equivalent of an admin force-logging-out a
 * compromised or stale session belonging to any user, platform-wide.
 * Takes effect immediately: getSession() checks revokedAt on every call, not
 * just at the revoked session's next natural JWT expiry.
 */
export async function revokeSessionAction(sessionId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "security", "edit");

  await db.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });

  await db.auditLog.create({
    data: {
      actorId: session.id,
      action: "session.revoked",
      resource: "user_session",
      newValue: JSON.stringify({ sessionId }),
      device: "Desktop",
      browser: "Admin Console",
    },
  });

  revalidatePath("/admin/security");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// API Keys -- the real secret is returned ONCE, at creation, never again.
// Only its SHA-256 hash and last-4 preview are persisted.
// ---------------------------------------------------------------------------

export async function getApiKeysAction() {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "security", "view");

  const keys = await db.apiKey.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return {
    ok: true as const,
    keys: keys.map((k) => ({
      id: k.id,
      label: k.label,
      keyPreview: `sk_live_••••${k.keyPreview}`,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    })),
  };
}

export async function createApiKeyAction(label: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "security", "edit");

  if (!label.trim()) return { ok: false as const, error: "Label is required." };

  const rawKey = `sk_live_${randomBytes(24).toString("base64url")}`;

  try {
    await db.apiKey.create({
      data: {
        label: label.trim(),
        keyHash: hashApiKey(rawKey),
        keyPreview: rawKey.slice(-4),
        createdById: session.id,
      },
    });
  } catch (err) {
    await logError({ source: "security.api_key.create", error: err, context: { label } });
    return { ok: false as const, error: "Failed to create API key. Please try again." };
  }

  await db.auditLog.create({
    data: {
      actorId: session.id,
      action: "api_key.created",
      resource: "api_key",
      newValue: JSON.stringify({ label }),
      device: "Desktop",
      browser: "Admin Console",
    },
  });

  revalidatePath("/admin/security");
  // The only time the real key is ever returned -- callers must show this
  // to the admin immediately and cannot retrieve it again afterward.
  return { ok: true as const, rawKey };
}

export async function revokeApiKeyAction(keyId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "security", "edit");

  await db.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });

  await db.auditLog.create({
    data: {
      actorId: session.id,
      action: "api_key.revoked",
      resource: "api_key",
      newValue: JSON.stringify({ keyId }),
      device: "Desktop",
      browser: "Admin Console",
    },
  });

  revalidatePath("/admin/security");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// IP allowlist
// ---------------------------------------------------------------------------

const CIDR_PATTERN = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

export async function getIpAllowlistAction() {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "security", "view");

  const entries = await db.ipAllowlistEntry.findMany({ orderBy: { createdAt: "asc" } });
  return { ok: true as const, entries: entries.map((e) => ({ id: e.id, cidr: e.cidr })) };
}

export async function addIpAllowlistEntryAction(cidr: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "security", "edit");

  const trimmed = cidr.trim();
  if (!CIDR_PATTERN.test(trimmed)) {
    return { ok: false as const, error: "Enter a valid IP address or CIDR range, e.g. 203.0.113.0/24." };
  }

  const existing = await db.ipAllowlistEntry.findUnique({ where: { cidr: trimmed } });
  if (existing) return { ok: false as const, error: "This entry already exists." };

  await db.ipAllowlistEntry.create({ data: { cidr: trimmed, createdById: session.id } });

  revalidatePath("/admin/security");
  return { ok: true as const };
}

export async function removeIpAllowlistEntryAction(entryId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "security", "edit");

  await db.ipAllowlistEntry.delete({ where: { id: entryId } });

  revalidatePath("/admin/security");
  return { ok: true as const };
}
