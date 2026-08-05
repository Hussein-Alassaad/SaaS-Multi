"use client";

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RESOURCES } from "@/lib/permissions";
import { Check, Minus } from "lucide-react";

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  userCount: number;
  resourcePermissions: Record<string, string[]>;
}

export function RolesMatrixClient({ roles }: { roles: RoleRow[] }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <div>
                <CardTitle>{role.name}</CardTitle>
                <CardDescription>{role.description}</CardDescription>
              </div>
              <Badge variant="outline">{role.userCount} users</Badge>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card padding="none">
        <div className="scroll-x-container">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border-hairline)]">
                <th className="sticky left-0 bg-[var(--surface-1)] px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-4)]">
                  Resource
                </th>
                {roles.map((r) => (
                  <th key={r.id} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-4)]">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESOURCES.map((resource) => (
                <tr key={resource} className="border-b border-[var(--border-hairline)] last:border-0">
                  <td className="sticky left-0 bg-[var(--surface-1)] px-4 py-2.5 text-[var(--text-2)] capitalize">
                    {resource.replace(/-/g, " ")}
                  </td>
                  {roles.map((r) => {
                    const perms = r.resourcePermissions[resource] ?? r.resourcePermissions["*"] ?? [];
                    const hasAccess = perms.length > 0;
                    return (
                      <td key={r.id} className="px-4 py-2.5">
                        {hasAccess ? (
                          <span className="flex items-center gap-1 text-xs text-[#4fd293]">
                            <Check className="h-3.5 w-3.5" />
                            {perms.join(", ")}
                          </span>
                        ) : (
                          <Minus className="h-3.5 w-3.5 text-[var(--text-5)]" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
