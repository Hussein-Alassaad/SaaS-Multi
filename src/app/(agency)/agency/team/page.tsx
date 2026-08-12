import { getTeamMembers, getPendingInvites, getAgencyRoles } from "@/lib/agency/team";
import { getTenantSession } from "@/lib/auth";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { TeamClient } from "./TeamClient";

export default async function TeamPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";
  const t = getDictionary(lang);

  const [members, invites, roles] = await Promise.all([
    getTeamMembers(tenantId),
    getPendingInvites(tenantId),
    getAgencyRoles(),
  ]);

  const serializedMembers = members
    .filter((m) => m.status !== "DISABLED")
    .map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      status: m.status,
      roleName: m.role?.name.replace(/^Agency /, "") ?? "—",
      lastLoginAt: m.lastLoginAt ? m.lastLoginAt.toISOString() : null,
    }));

  const serializedInvites = invites.map((i) => ({
    id: i.id,
    email: i.email,
    roleName: i.role.name.replace(/^Agency /, ""),
    invitedByName: i.invitedBy?.name ?? null,
    createdAt: i.createdAt.toISOString(),
  }));

  const roleOptions = roles.map((r) => r.name.replace(/^Agency /, ""));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.team.title}</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">{t.team.subtitle}</p>
      </div>

      <TeamClient
        members={serializedMembers}
        invites={serializedInvites}
        roleOptions={roleOptions}
        currentUserId={session!.id}
        lang={lang}
      />
    </div>
  );
}
