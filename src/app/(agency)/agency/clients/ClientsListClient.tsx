"use client";

import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { timeAgo } from "@/lib/utils";
import { getDictionary, type UiLanguage } from "@/lib/i18n";

interface ClientRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  tag: string;
  conversationCount: number;
  updatedAt: string;
}

const TAG_VARIANT: Record<string, "neutral" | "warm" | "accent" | "success" | "hot" | "outline"> = {
  REPLIED: "neutral",
  INTERESTED: "warm",
  NOT_RESPONDING: "outline",
  LOST: "hot",
  CONVERTED: "success",
};

export function ClientsListClient({ clients, lang }: { clients: ClientRow[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const router = useRouter();

  const columns: Column<ClientRow>[] = [
    {
      key: "name",
      header: t.clients.colClient,
      render: (c) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={c.name ?? c.phone ?? "?"} size="sm" />
          <div className="min-w-0">
            <div className="font-medium text-[var(--text-1)] truncate">{c.name ?? t.clients.unknown}</div>
            <div className="text-xs text-[var(--text-5)] truncate">{c.phone ?? c.email ?? "—"}</div>
          </div>
        </div>
      ),
    },
    { key: "company", header: t.clients.colCompany, render: (c) => c.company ?? "—" },
    { key: "conversations", header: t.clients.colConversations, render: (c) => c.conversationCount.toString() },
    {
      key: "tag",
      header: t.clients.colStatus,
      render: (c) => <Badge variant={TAG_VARIANT[c.tag] ?? "neutral"}>{t.tag[c.tag as keyof typeof t.tag] ?? c.tag.replace(/_/g, " ")}</Badge>,
    },
    { key: "updated", header: t.clients.colLastActivity, render: (c) => timeAgo(c.updatedAt) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.clients.title}</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          {t.clients.subtitle}
        </p>
      </div>

      <DataTable
        columns={columns}
        data={clients}
        rowKey={(c) => c.id}
        emptyMessage={t.clients.emptyMessage}
        onRowClick={(c) => router.push(`/agency/clients/${c.id}`)}
      />
    </div>
  );
}
