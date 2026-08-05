"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { timeAgo } from "@/lib/utils";

interface UserRow {
  id: string;
  name: string;
  email: string;
  scope: string;
  status: string;
  roleName: string | null;
  tenantName: string | null;
  lastLoginAt: string | null;
}

export function UsersTableClient({ users }: { users: UserRow[] }) {
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState("ALL");

  const filtered = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchesScope = scopeFilter === "ALL" || u.scope === scopeFilter;
    return matchesSearch && matchesScope;
  });

  const columns: Column<UserRow>[] = [
    {
      key: "user",
      header: "User",
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={u.name} size="sm" />
          <div className="min-w-0">
            <div className="font-medium text-[var(--text-1)] truncate">{u.name}</div>
            <div className="text-xs text-[var(--text-5)] truncate">{u.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "scope",
      header: "Scope",
      render: (u) => <Badge variant={u.scope === "PLATFORM" ? "accent" : "outline"}>{u.scope}</Badge>,
    },
    { key: "role", header: "Role / Tenant", render: (u) => u.roleName ?? u.tenantName ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (u) => (
        <Badge variant={u.status === "ACTIVE" ? "success" : u.status === "SUSPENDED" ? "hot" : "neutral"}>
          {u.status}
        </Badge>
      ),
    },
    {
      key: "lastLogin",
      header: "Last Login",
      render: (u) => (u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select
          value={scopeFilter}
          onValueChange={setScopeFilter}
          options={[
            { value: "ALL", label: "All scopes" },
            { value: "PLATFORM", label: "Platform" },
            { value: "TENANT", label: "Tenant" },
          ]}
          className="w-40"
        />
        <span className="text-xs text-[var(--text-4)]">{filtered.length} users</span>
      </div>
      <DataTable columns={columns} data={filtered} rowKey={(u) => u.id} />
    </div>
  );
}
