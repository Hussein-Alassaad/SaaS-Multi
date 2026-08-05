import { getUsersList } from "@/lib/mock/users";
import { UsersTableClient } from "./UsersTableClient";
import { KpiCard } from "@/components/ui/KpiCard";
import { Users as UsersIcon, ShieldCheck, Building2, UserCheck } from "lucide-react";

export default async function UsersPage() {
  const users = await getUsersList();

  const platformCount = users.filter((u) => u.scope === "PLATFORM").length;
  const tenantCount = users.filter((u) => u.scope === "TENANT").length;
  const activeCount = users.filter((u) => u.status === "ACTIVE").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Users</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Global directory of platform admins and tenant-side users in one table.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Total Users" value={users.length.toString()} icon={<UsersIcon className="h-3.5 w-3.5" />} />
        <KpiCard label="Platform Admins" value={platformCount.toString()} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
        <KpiCard label="Tenant Users" value={tenantCount.toString()} icon={<Building2 className="h-3.5 w-3.5" />} />
        <KpiCard label="Active" value={activeCount.toString()} icon={<UserCheck className="h-3.5 w-3.5" />} />
      </div>

      <UsersTableClient
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          scope: u.scope,
          status: u.status,
          roleName: u.role?.name ?? null,
          tenantName: u.tenant?.companyName ?? null,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
