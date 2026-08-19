"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  loadMoreClientHistoryAction,
  getLeadRepliesAction,
  exportClientHistoryCsvAction,
} from "@/lib/actions/outreach-clients";

export interface ClientHistoryRow {
  id: string;
  leadId: string | null;
  businessName: string | null;
  contacted: boolean;
  temperature: string | null;
  platform: string | null;
  industry: string | null;
  score: number | null;
}

interface ReplyItem {
  id: string;
  channel: string;
  body: string;
  accountId: string | null;
  repliedAt: string;
}

const TEMPERATURE_VARIANT: Record<string, "hot" | "warm" | "cold"> = { hot: "hot", warm: "warm", cold: "cold" };

function TemperatureBadge({ temperature }: { temperature: string | null }) {
  if (!temperature) return null;
  const variant = TEMPERATURE_VARIANT[temperature] ?? "neutral";
  return (
    <Badge variant={variant} dot className="capitalize">
      {temperature}
    </Badge>
  );
}

/**
 * Expandable panel showing what a lead actually replied, and from which
 * account. Lazy-loaded per row on first expand rather than joined into the
 * main query -- most leads were never contacted, let alone replied, so
 * eagerly fetching replies for every row in the list would mostly be waste.
 * Cached by the parent (repliesCache) so re-collapsing/re-expanding a row
 * doesn't refetch.
 */
function ReplyPanel({
  replies,
  accountLabels,
}: {
  replies: ReplyItem[] | null;
  accountLabels: Record<string, string>;
}) {
  if (replies === null) {
    return <Skeleton className="mt-2 h-10 w-full" />;
  }
  if (replies.length === 0) {
    return <p className="mt-2 text-xs text-[var(--text-5)]">No reply recorded yet.</p>;
  }

  return (
    <div className="mt-2 space-y-2">
      {replies.map((reply) => (
        <div key={reply.id} className="rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/60 p-2.5">
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-5)]">
            <span className="uppercase tracking-wide">{reply.channel}</span>
            <span>
              {(reply.accountId && accountLabels[reply.accountId]) || "Unknown account"} ·{" "}
              {new Date(reply.repliedAt).toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--text-2)]">{reply.body}</p>
        </div>
      ))}
    </div>
  );
}

// Columns pulled from row.snapshot -- the full lead row captured at analysis
// time -- richer than the summary fields client_history keeps on its own
// columns, and exactly the fields a cold-outreach spreadsheet needs (profile
// url, follower count, website, WhatsApp number, founder). Mirrors
// ClientHistory.jsx's `_EXPORT_COLUMNS` exactly.
const EXPORT_COLUMNS: [string, string][] = [
  ["business_name", "Business Name"],
  ["platform", "Platform"],
  ["industry", "Industry"],
  ["profile_url", "Profile URL"],
  ["website", "Website"],
  ["follower_count", "Followers"],
  ["whatsapp_number", "WhatsApp Number"],
  ["founder_name", "Founder Name"],
  ["score", "Score"],
  ["temperature", "Temperature"],
  ["contacted", "Contacted"],
];

interface ExportRow {
  id: string;
  businessName: string | null;
  platform: string | null;
  industry: string | null;
  score: number | null;
  temperature: string | null;
  contacted: boolean;
  founderName: string | null;
  snapshot: Record<string, unknown>;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = Array.isArray(value) ? value.join("; ") : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// row -> snake_case field lookup for the columns export rows carry outside
// `snapshot` (businessName -> business_name, etc.), so `snapshot[key] ??
// row[key]` fallback mirrors the original's `snapshot[key] ?? row[key]`.
function rowFallback(row: ExportRow, key: string): unknown {
  switch (key) {
    case "business_name":
      return row.businessName;
    case "platform":
      return row.platform;
    case "industry":
      return row.industry;
    case "score":
      return row.score;
    case "temperature":
      return row.temperature;
    case "contacted":
      return row.contacted;
    case "founder_name":
      return row.founderName;
    default:
      return undefined;
  }
}

function rowsToCsv(rows: ExportRow[]): string {
  const header = EXPORT_COLUMNS.map(([, label]) => csvEscape(label)).join(",");
  const lines = rows.map((row) => {
    const snapshot = row.snapshot || {};
    return EXPORT_COLUMNS.map(([key]) => csvEscape(snapshot[key] ?? rowFallback(row, key))).join(",");
  });
  return [header, ...lines].join("\r\n");
}

function downloadCsv(rows: ExportRow[]) {
  const csv = rowsToCsv(rows);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `nexaris-leads-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ClientHistoryClient({
  initialRows,
  initialNextCursor,
}: {
  tenantId: string;
  initialRows: ClientHistoryRow[];
  initialNextCursor: string | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, startLoadMoreTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [repliesCache, setRepliesCache] = useState<
    Record<string, { replies: ReplyItem[]; accountLabels: Record<string, string> }>
  >({});

  async function runSearch(nextSearch: string) {
    setLoading(true);
    setError(null);
    const result = await loadMoreClientHistoryAction("", nextSearch);
    setLoading(false);
    if (result.ok) {
      setRows(result.rows);
      setNextCursor(result.nextCursor);
    } else {
      setError(result.error);
    }
  }

  // Search is debounced; the initial mount load already happened server-side
  // (initialRows), so the first effect run is skipped -- mirrors
  // ClientHistory.jsx's mounted-guard pattern.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const timeout = setTimeout(() => {
      runSearch(search);
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);

  function loadMore() {
    if (!nextCursor) return;
    startLoadMoreTransition(async () => {
      const result = await loadMoreClientHistoryAction(nextCursor, search);
      if (result.ok) {
        setRows((prev) => [...prev, ...result.rows]);
        setNextCursor(result.nextCursor);
      } else {
        setError(result.error);
      }
    });
  }

  async function toggleExpand(row: ClientHistoryRow) {
    if (!row.leadId) return;
    const leadId = row.leadId;
    if (expandedId === leadId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(leadId);
    if (repliesCache[leadId]) return;
    const result = await getLeadRepliesAction(leadId);
    if (result.ok) {
      setRepliesCache((prev) => ({ ...prev, [leadId]: { replies: result.replies, accountLabels: result.accountLabels } }));
    }
  }

  async function handleExport() {
    setExporting(true);
    const result = await exportClientHistoryCsvAction(search);
    setExporting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    downloadCsv(result.rows);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
            Client <span className="text-gradient">History</span>
          </h1>
          <p className="mt-1 text-sm text-[var(--text-4)]">Every lead ever analyzed, permanently.</p>
        </div>
        <button
          type="button"
          disabled={rows.length === 0 || exporting}
          onClick={handleExport}
          className="shrink-0 rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-3 py-2 text-xs font-medium text-[var(--text-2)] outline-none transition-colors hover:border-[var(--accent-from)]/50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </motion.header>

      <input
        type="search"
        placeholder="Search by business name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mt-4 w-full rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-3 py-2.5 text-sm text-[var(--text-1)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
      />

      {error && <p className="mt-6 text-sm text-[var(--status-hot)]">{error}</p>}
      {!error && loading && (
        <div className="mt-6 space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}
      {!error && !loading && rows.length === 0 && <p className="mt-6 text-sm text-[var(--text-5)]">No matches.</p>}

      {!loading && (
        <div className="mt-6 space-y-2">
          <AnimatePresence mode="popLayout">
            {rows.map((row) => {
              const cached = row.leadId ? repliesCache[row.leadId] : undefined;
              return (
                <motion.div
                  key={row.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  onClick={() => toggleExpand(row)}
                  className={`glass glass-hover rounded-xl p-3 ${row.leadId ? "cursor-pointer" : ""}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-[var(--text-1)]">{row.businessName || "Unnamed business"}</p>
                    <div className="flex items-center gap-2">
                      {row.contacted && (
                        <span className="rounded-full border border-[#4fd293]/30 bg-[#4fd293]/10 px-2 py-0.5 text-xs text-[#3fb87e]">
                          Contacted
                        </span>
                      )}
                      <TemperatureBadge temperature={row.temperature} />
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-5)]">
                    {row.platform} {row.industry ? `· ${row.industry}` : ""} {row.score != null ? `· ${row.score}/10` : ""}
                  </p>
                  {row.leadId && (
                    <p className="mt-1.5 text-[11px] text-[var(--text-5)]">
                      {expandedId === row.leadId ? "Hide replies ▲" : "View replies ▼"}
                    </p>
                  )}
                  <AnimatePresence>
                    {expandedId === row.leadId && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        className="overflow-hidden"
                      >
                        <ReplyPanel replies={cached?.replies ?? null} accountLabels={cached?.accountLabels ?? {}} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {!loading && nextCursor && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-4 py-2 text-xs font-medium text-[var(--text-3)] outline-none transition-colors hover:border-[var(--accent-from)]/50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
