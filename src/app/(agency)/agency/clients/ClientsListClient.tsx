"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { timeAgo } from "@/lib/utils";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { loadMoreClientsAction } from "@/lib/actions/agency-clients";

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

export function ClientsListClient({
  clients: initialClients,
  initialNextCursor,
  lang,
}: {
  clients: ClientRow[];
  initialNextCursor: string | null;
  lang: UiLanguage;
}) {
  const t = getDictionary(lang);
  const router = useRouter();
  const [clients, setClients] = useState(initialClients);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, startLoadMoreTransition] = useTransition();

  const handleLoadMore = () => {
    if (!nextCursor) return;
    startLoadMoreTransition(async () => {
      const result = await loadMoreClientsAction(nextCursor);
      if (result.ok) {
        setClients((prev) => [...prev, ...result.clients]);
        setNextCursor(result.nextCursor);
      }
    });
  };

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

      {nextCursor && (
        <div className="flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--text-4)] hover:bg-[var(--surface-2)] disabled:opacity-50"
          >
            {loadingMore ? t.common.loadingMore : t.common.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
