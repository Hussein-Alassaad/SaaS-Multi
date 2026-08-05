import { getRolesWithPermissions } from "@/lib/mock/roles";
import { RolesMatrixClient } from "./RolesMatrixClient";

export default async function RolesPage() {
  const roles = await getRolesWithPermissions();

  const rows = roles.map((r) => {
    const resourcePermissions: Record<string, string[]> = {};
    for (const p of r.permissions) {
      resourcePermissions[p.resource] = resourcePermissions[p.resource] ?? [];
      resourcePermissions[p.resource].push(p.action);
    }
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      userCount: r.users.length,
      resourcePermissions,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Roles & Permissions</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Internal admin roles and what each one can access across the platform.
        </p>
      </div>

      <RolesMatrixClient roles={rows} />
    </div>
  );
}
