"use server";

import { redirect } from "next/navigation";
import { db, withTenant, withPlatformAccess } from "@/lib/db";
import { hashPassword, createSessionToken, setSessionCookie } from "@/lib/auth";
import { passwordSchema } from "@/types/signup";

export interface AcceptInviteState {
  error?: string;
}

export async function acceptInviteAction(_prevState: AcceptInviteState, formData: FormData): Promise<AcceptInviteState> {
  const inviteId = String(formData.get("inviteId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!inviteId) return { error: "Missing invite." };

  // Platform-scoped read: this runs BEFORE the user is authenticated and
  // before any tenant is known -- the invite id (an unguessable cuid, which
  // is the accept-link token itself) is the only thing identifying which
  // tenant this even belongs to. Every write below is scoped to
  // invite.tenantId once it is known.
  const invite = await withPlatformAccess((tx) =>
    tx.teamInvite.findUnique({ where: { id: inviteId }, include: { tenant: true } })
  );
  if (!invite || invite.status !== "PENDING") {
    return { error: "This invite is invalid or has already been used." };
  }

  const existingUser = await db.user.findUnique({ where: { email: invite.email } });

  if (existingUser) {
    // Edge case: the invited email already has a User row (e.g. platform
    // staff being added to a tenant). Just attach them to this tenant/role
    // rather than creating a duplicate account.
    // Was a db.$transaction([...]) array -- sequential against one tx now,
    // scoped to the invite's own tenant, still atomic.
    await withTenant(invite.tenantId, async (tx) => {
      await tx.user.update({
        where: { id: existingUser.id },
        data: { tenantId: invite.tenantId, roleId: invite.roleId, scope: "TENANT", status: "ACTIVE" },
      });
      await tx.teamInvite.update({ where: { id: inviteId }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    });

    const token = await createSessionToken({ id: existingUser.id, role: "", scope: "TENANT" });
    await setSessionCookie(token);
    redirect("/agency");
  }

  if (!name) return { error: "Enter your name." };
  const parsedPassword = passwordSchema.safeParse(password);
  if (!parsedPassword.success) {
    return { error: parsedPassword.error.issues[0]?.message ?? "Invalid password." };
  }

  const passwordHash = await hashPassword(parsedPassword.data);

  // Was a db.$transaction([...]) array -- sequential against one tx now,
  // scoped to the invite's own tenant, still atomic.
  const user = await withTenant(invite.tenantId, async (tx) => {
    const user = await tx.user.create({
      data: {
        email: invite.email,
        name,
        scope: "TENANT",
        status: "ACTIVE",
        tenantId: invite.tenantId,
        roleId: invite.roleId,
        passwordHash,
        verifiedAt: new Date(), // accepting the invite is itself proof of email ownership
      },
    });
    await tx.teamInvite.update({ where: { id: inviteId }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    return user;
  });

  const roleRow = await db.role.findUnique({ where: { id: invite.roleId } });
  const token = await createSessionToken({ id: user.id, role: roleRow?.name ?? "", scope: "TENANT" });
  await setSessionCookie(token);

  redirect("/agency");
}
