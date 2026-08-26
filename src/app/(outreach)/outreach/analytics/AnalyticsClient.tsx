"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { KpiCard } from "@/components/ui/KpiCard";
import { OutreachLeadsTrendChart } from "@/components/charts/OutreachLeadsTrendChart";
import { OutreachTemperatureChart } from "@/components/charts/OutreachTemperatureChart";
import { OutreachPlatformChart } from "@/components/charts/OutreachPlatformChart";

export interface AnalyticsLeadRow {
  platform: string;
  temperature: string | null;
  status: string;
  contactCount: number;
  createdAt: string;
}

type RangeKey = "all" | "today" | "7d" | "30d" | "custom";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "custom", label: "Custom" },
];

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

// Resolves a range key to [start, end] instants. "all" returns null bounds
// (no filtering). Custom trusts whatever was picked in the two date inputs,
// defaulting the end to now if only a start was set.
function resolveBounds(rangeKey: RangeKey, customStart: string, customEnd: string): { start: Date | null; end: Date | null } {
  const end = new Date();
  if (rangeKey === "all") return { start: null, end: null };
  if (rangeKey === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  if (rangeKey === "7d") {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  if (rangeKey === "30d") {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  // custom
  const start = customStart ? new Date(`${customStart}T00:00:00`) : null;
  const customEndDate = customEnd ? new Date(`${customEnd}T23:59:59`) : end;
  return { start, end: customEndDate };
}

interface Bucket {
  key: string | number;
  label: string;
}

// Bucket keys for the trend chart + sparklines. "today" buckets by hour for
// useful granularity on a single day; every other range buckets by day,
// capped at 90 buckets.
function buildBuckets(rangeKey: RangeKey, start: Date | null, end: Date | null): Bucket[] {
  if (rangeKey === "today") {
    return Array.from({ length: 24 }, (_, h) => ({ key: h, label: `${String(h).padStart(2, "0")}:00` }));
  }
  const rangeStart = start
    ? new Date(start)
    : (() => {
        const d = new Date();
        d.setDate(d.getDate() - 13);
        d.setHours(0, 0, 0, 0);
        return d;
      })();
  const rangeEnd = end ? new Date(end) : new Date();
  rangeStart.setHours(0, 0, 0, 0);
  rangeEnd.setHours(0, 0, 0, 0);

  const buckets: Bucket[] = [];
  const cur = new Date(rangeStart);
  while (cur <= rangeEnd && buckets.length < 90) {
    const iso = cur.toISOString().slice(0, 10);
    buckets.push({ key: iso, label: iso.slice(5) });
    cur.setDate(cur.getDate() + 1);
  }
  return buckets;
}

// One pass over the leads array, grouping each lead into its bucket key --
// avoids re-filtering the full array once per bucket per trend line.
function groupByBucket(rangeKey: RangeKey, leadsList: AnalyticsLeadRow[]): Map<string | number, AnalyticsLeadRow[]> {
  const map = new Map<string | number, AnalyticsLeadRow[]>();
  for (const l of leadsList) {
    if (!l.createdAt) continue;
    const key = rangeKey === "today" ? new Date(l.createdAt).getHours() : l.createdAt.slice(0, 10);
    const bucket = map.get(key);
    if (bucket) bucket.push(l);
    else map.set(key, [l]);
  }
  return map;
}

function countInBucket(
  bucketKey: string | number,
  groupedMap: Map<string | number, AnalyticsLeadRow[]>,
  predicate: (l: AnalyticsLeadRow) => boolean = () => true
) {
  const bucket = groupedMap.get(bucketKey);
  return bucket ? bucket.filter(predicate).length : 0;
}

function RangeFilter({
  rangeKey,
  onChange,
  customStart,
  customEnd,
  onCustomChange,
}: {
  rangeKey: RangeKey;
  onChange: (key: RangeKey) => void;
  customStart: string;
  customEnd: string;
  onCustomChange: (v: { start: string; end: string }) => void;
}) {
  return (
    <div className="mt-4">
      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-2)]/40 p-1 backdrop-blur-sm">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => onChange(r.key)}
            className={`relative rounded-lg px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)] ${
              rangeKey === r.key ? "text-[var(--text-1)]" : "text-[var(--text-5)] hover:text-[var(--text-3)]"
            }`}
          >
            {rangeKey === r.key && (
              <motion.span
                layoutId="analytics-range-pill"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="absolute inset-0 rounded-lg bg-gradient-to-r from-[var(--accent-from)]/25 to-[var(--accent-to)]/15 ring-1 ring-[var(--accent-from)]/30"
              />
            )}
            <span className="relative">{r.label}</span>
          </button>
        ))}
      </div>

      {rangeKey === "custom" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-4)]"
        >
          <label className="flex flex-wrap items-center gap-1.5">
            From
            <input
              type="date"
              value={customStart}
              onChange={(e) => onCustomChange({ start: e.target.value, end: customEnd })}
              className="min-w-0 max-w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-2)]/50 px-2 py-1 text-[var(--text-2)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
            />
          </label>
          <label className="flex flex-wrap items-center gap-1.5">
            To
            <input
              type="date"
              value={customEnd}
              onChange={(e) => onCustomChange({ start: customStart, end: e.target.value })}
              className="min-w-0 max-w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-2)]/50 px-2 py-1 text-[var(--text-2)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
            />
          </label>
        </motion.div>
      )}
    </div>
  );
}

export function AnalyticsClient({ leads }: { leads: AnalyticsLeadRow[] }) {
  const [rangeKey, setRangeKey] = useState<RangeKey>("all");
  const [customStart, setCustomStart] = useState(() => toDateInputValue(new Date(Date.now() - 6 * 86400000)));
  const [customEnd, setCustomEnd] = useState(() => toDateInputValue(new Date()));

  // Every KPI, bucket, and trend line derives from `leads` + the active
  // range/custom-date state -- memoized so it only reruns when one of these
  // actually changes (not on every render).
  const derived = useMemo(() => {
    const { start, end } = resolveBounds(rangeKey, customStart, customEnd);
    const scoped = start
      ? leads.filter((l) => l.createdAt && new Date(l.createdAt) >= start && (!end || new Date(l.createdAt) <= end))
      : leads;

    const total = scoped.length;
    const hot = scoped.filter((l) => l.temperature === "hot").length;
    const warm = scoped.filter((l) => l.temperature === "warm").length;
    const cold = scoped.filter((l) => l.temperature === "cold").length;
    const contacted = scoped.filter((l) => l.contactCount > 0 || l.status === "contacted").length;
    const replied = scoped.filter((l) => l.status === "replied").length;
    const replyRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
    const linkedinCount = scoped.filter((l) => l.platform === "linkedin").length;
    const instagramCount = scoped.filter((l) => l.platform === "instagram").length;
    const emailCount = scoped.filter((l) => l.platform === "email").length;

    const buckets = buildBuckets(rangeKey, start, end);
    const grouped = groupByBucket(rangeKey, scoped);
    const dailyCounts = buckets.map((b) => ({ date: b.label, leads: countInBucket(b.key, grouped) }));

    // Sparklines get at most the trailing 7 buckets -- a glance, not the full trend.
    const sparkBuckets = buckets.slice(-7);
    const trendFor = (predicate?: (l: AnalyticsLeadRow) => boolean) =>
      sparkBuckets.map((b) => countInBucket(b.key, grouped, predicate));
    const totalTrend = trendFor();
    const hotTrend = trendFor((l) => l.temperature === "hot");
    const warmTrend = trendFor((l) => l.temperature === "warm");
    const coldTrend = trendFor((l) => l.temperature === "cold");

    const temperatureData = (
      [
        { name: "Hot", value: hot, key: "hot" as const },
        { name: "Warm", value: warm, key: "warm" as const },
        { name: "Cold", value: cold, key: "cold" as const },
      ]
    ).filter((d) => d.value > 0);

    const platformData = [
      { name: "LinkedIn", leads: linkedinCount },
      { name: "Instagram", leads: instagramCount },
      { name: "Email", leads: emailCount },
    ];

    return {
      total, hot, warm, cold, contacted, replied, replyRate, linkedinCount, instagramCount, emailCount,
      dailyCounts, totalTrend, hotTrend, warmTrend, coldTrend, temperatureData, platformData,
    };
  }, [leads, rangeKey, customStart, customEnd]);

  const {
    total, hot, warm, cold, contacted, replied, replyRate, linkedinCount, instagramCount, emailCount,
    dailyCounts, totalTrend, hotTrend, warmTrend, coldTrend, temperatureData, platformData,
  } = derived;

  const rangeLabel = RANGES.find((r) => r.key === rangeKey)?.label ?? "All time";
  const subtitle =
    rangeKey === "all"
      ? "All-time totals across every lead ever discovered."
      : rangeKey === "custom"
        ? `Totals from ${customStart || "…"} to ${customEnd || "…"}.`
        : `Totals for ${rangeLabel.toLowerCase()}.`;
  const chartTitle =
    rangeKey === "all" ? "Leads discovered — last 14 days" : `Leads discovered — ${rangeLabel.toLowerCase()}`;

  return (
    <div className="mx-auto max-w-5xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          <span className="text-gradient">Analytics</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">{subtitle}</p>
      </motion.header>

      <RangeFilter
        rangeKey={rangeKey}
        onChange={setRangeKey}
        customStart={customStart}
        customEnd={customEnd}
        onCustomChange={({ start: s, end: e }) => {
          setCustomStart(s);
          setCustomEnd(e);
        }}
      />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Total leads" value={String(total)} highlight trend={totalTrend} />
        <KpiCard label="Hot" value={String(hot)} trend={hotTrend} />
        <KpiCard label="Warm" value={String(warm)} trend={warmTrend} />
        <KpiCard label="Cold" value={String(cold)} trend={coldTrend} />
        <KpiCard label="Contacted" value={String(contacted)} />
        <KpiCard label="Replied" value={String(replied)} />
        <KpiCard label="Reply rate" value={`${replyRate}%`} />
        <KpiCard label="LinkedIn leads" value={String(linkedinCount)} />
        <KpiCard label="Instagram leads" value={String(instagramCount)} />
        <KpiCard label="Email leads" value={String(emailCount)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <OutreachLeadsTrendChart data={dailyCounts} title={chartTitle} />
        </div>
        <OutreachTemperatureChart data={temperatureData} total={hot + warm + cold} />
      </div>

      <div className="mt-4">
        <OutreachPlatformChart data={platformData} />
      </div>
    </div>
  );
}
