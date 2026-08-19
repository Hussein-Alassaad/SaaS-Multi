"use client";

import { useState, useRef, useEffect, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { loadMoreClientsAction } from "@/lib/actions/outreach-clients";
import { useOutreachRealtime } from "@/lib/outreach/realtime";

export interface ClientCardData {
  id: string;
  businessName: string | null;
  platform: string;
  industry: string | null;
  score: number | null;
  temperature: string | null;
  status: string;
  founderFound: boolean;
  founderName: string | null;
  whatsappFound: boolean;
  whatsappNumber: string | null;
  contactCount: number;
  createdAt: string;
}

type Filter = "all" | "numbers";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All clients" },
  { key: "numbers", label: "Numbers found" },
];

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

export function ClientsClient({
  tenantId,
  initialClients,
  initialNextCursor,
  initialCounts,
}: {
  tenantId: string;
  initialClients: ClientCardData[];
  initialNextCursor: string | null;
  initialCounts: { total: number; numbersFound: number };
}) {
  const [clients, setClients] = useState(initialClients);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [counts, setCounts] = useState(initialCounts);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [loadingMore, startLoadMoreTransition] = useTransition();
  const router = useRouter();

  // Keep local state in sync whenever the server page re-fetches (realtime
  // reload via router.refresh() re-runs page.tsx with fresh initial props).
  // Updated during render (not in an effect, and not via a ref -- this repo's
  // lint config forbids ref reads/writes during render) so a fresh prop is
  // reflected in the same commit instead of flashing stale state for one frame.
  const [prevInitialClients, setPrevInitialClients] = useState(initialClients);
  if (prevInitialClients !== initialClients) {
    setPrevInitialClients(initialClients);
    setClients(initialClients);
    setNextCursor(initialNextCursor);
    setCounts(initialCounts);
  }

  async function runSearch(nextSearch: string, nextFilter: Filter) {
    setLoading(true);
    const result = await loadMoreClientsAction("", nextSearch, nextFilter);
    setLoading(false);
    if (result.ok) {
      setClients(result.clients as ClientCardData[]);
      setNextCursor(result.nextCursor);
    }
  }

  // Search is debounced (typing shouldn't fire one query per keystroke);
  // filter pill clicks fire immediately -- a single deliberate click has
  // nothing to debounce against. Mirrors Clients.jsx's split-effect approach.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) return;
    const timeout = setTimeout(() => {
      runSearch(search, filter);
    }, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    runSearch(search, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const handleLoadMore = () => {
    if (!nextCursor) return;
    startLoadMoreTransition(async () => {
      const result = await loadMoreClientsAction(nextCursor, search, filter);
      if (result.ok) {
        setClients((prev) => [...prev, ...(result.clients as ClientCardData[])]);
        setNextCursor(result.nextCursor);
      }
    });
  };

  const reload = useCallback(() => router.refresh(), [router]);
  useOutreachRealtime({ table: "outreach_leads", tenantId, reload });

  return (
    <div className="mx-auto max-w-4xl">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
            <span className="text-gradient">Clients</span>
          </h1>
          <p className="mt-1 text-sm text-[var(--text-4)]">
            Every business the agent has ever reached details on, one place, always current.
          </p>
        </div>
        <div className="shrink-0 rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-3.5 py-2 text-right">
          <p className="text-lg font-semibold tabular-nums text-[var(--text-1)]">{counts.total}</p>
          <p className="text-[11px] uppercase tracking-wide text-[var(--text-5)]">Total clients</p>
        </div>
      </motion.header>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          placeholder="Search by business name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-3 py-2.5 text-sm text-[var(--text-1)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)] sm:max-w-xs"
        />
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)] ${
                filter === f.key
                  ? "border-[var(--accent-from)]/60 bg-[var(--accent-from)]/10 text-[var(--text-1)]"
                  : "border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 text-[var(--text-4)] hover:text-[var(--text-2)]"
              }`}
            >
              {f.label}
              {f.key === "numbers" && counts.numbersFound > 0 && (
                <span className="ml-1.5 rounded-full bg-[#4fd293]/20 px-1.5 text-[#3fb87e]">{counts.numbersFound}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {filter === "numbers" && (
        <p className="mt-3 text-xs text-[var(--text-5)]">
          Leads with a real phone/WhatsApp number the agent extracted from their profile — ready for direct cold-calling.
        </p>
      )}

      {loading && (
        <div className="mt-6 space-y-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {!loading && clients.length === 0 && (
        <p className="mt-6 text-sm text-[var(--text-5)]">
          {filter === "numbers" ? "No numbers found yet." : "No clients yet."}
        </p>
      )}

      {!loading && (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {clients.map((lead) => (
            <motion.div
              key={lead.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Link href={`/outreach/leads/${lead.id}`} className="glass glass-hover block h-full rounded-xl p-3.5 transition">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--text-1)]">{lead.businessName || "Unnamed business"}</p>
                  <TemperatureBadge temperature={lead.temperature} />
                </div>
                <p className="mt-1 text-xs text-[var(--text-5)]">
                  {lead.platform} {lead.industry ? `· ${lead.industry}` : ""} {lead.score != null ? `· ${lead.score}/10` : ""}
                </p>
                <p className="mt-1 text-xs capitalize text-[var(--text-5)]">Status: {(lead.status || "").replace(/_/g, " ")}</p>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {lead.founderFound && (
                    <span className="rounded-full border border-[var(--accent-from)]/30 bg-[var(--accent-from)]/10 px-2 py-0.5 text-[11px] text-[var(--accent-from)]">
                      Founder: {lead.founderName}
                    </span>
                  )}
                  {lead.whatsappFound && lead.whatsappNumber && (
                    <span className="rounded-full border border-[#4fd293]/30 bg-[#4fd293]/10 px-2 py-0.5 text-[11px] text-[#3fb87e]">
                      {lead.whatsappNumber}
                    </span>
                  )}
                  {lead.contactCount > 0 && (
                    <span className="rounded-full border border-[var(--status-cold)]/30 bg-[var(--status-cold)]/10 px-2 py-0.5 text-[11px] text-[var(--status-cold)]">
                      Contacted ×{lead.contactCount}
                    </span>
                  )}
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      {!loading && nextCursor && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
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
