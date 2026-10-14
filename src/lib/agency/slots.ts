/**
 * Meeting times: timezone handling, customer-facing wording, and automatic
 * slot generation from working hours.
 *
 * Why timezones matter here: slots are stored as UTC instants, but the AI
 * writes the time into a chat to a customer, and the owner types times into a
 * form. Both must mean the BUSINESS's local time (Localization settings),
 * not the server's (UTC on Vercel) -- otherwise "3 pm" arrives as 6 pm in
 * Beirut. No date library: everything goes through Intl.
 */

import type { Prisma } from "@prisma/client";

// Used when a workspace has no (valid) timezone saved. Morocco, where the first client is; a workspace elsewhere sets its own in
// Settings > Localization. (Intl knows Morocco's Ramadan clock change, so nothing special is needed.)
export const DEFAULT_TIMEZONE = "Africa/Casablanca";

/** Falls back to UTC for a timezone name Intl does not know, so a typo in Settings cannot break replies. */
export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Milliseconds to add to a UTC instant to get wall-clock time in tz at that instant. */
function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads y-m-d h:min. (DST gaps resolve to the later valid time.) */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let utc = guess - offsetMs(guess, tz);
  // A second pass fixes the case where the offset at the first estimate differs from the offset at the real instant (DST change).
  utc = guess - offsetMs(utc, tz);
  return new Date(utc);
}

/** Parses a <input type="datetime-local"> value ("2026-10-14T15:00") as wall-clock time in tz. */
export function parseLocalInput(value: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const d = zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
  return isNaN(d.getTime()) ? null : d;
}

/** The local calendar date in tz, as a UTC-midnight Date (so dates compare and step with plain arithmetic). */
export function localDateOf(instant: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

export type SlotLabelLanguage = import("@/lib/agency/language").ReplyLanguage;

/**
 * How a time is written to the customer: "Tuesday 14 October, 3:00 PM" in
 * English/Arabizi, the Arabic equivalent for Arabic-script customers (with
 * Western digits, which is how Lebanese customers write times in chat).
 */
export function formatSlotLabel(startsAt: Date, tz: string, language: SlotLabelLanguage): string {
  const arabic = language === "AR" || language === "AR_MA" || language === "AR_LB";
  const locale = arabic ? "ar-u-nu-latn" : language === "FR" || language === "ARABIZI_MA" ? "fr-FR" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    timeZone: safeTimezone(tz),
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: locale !== "fr-FR", // French writes 15:00, not 3:00 PM
  }).format(startsAt);
}

export interface AvailabilityConfig {
  meetingAutoSlots: boolean;
  meetingDays: string;
  meetingStartHour: number;
  meetingEndHour: number;
  meetingDurationMin: number;
  meetingHorizonDays: number;
  meetingSlotsThrough: Date | null;
}

const MIN_LEAD_MS = 2 * 60 * 60 * 1000; // never offer a time starting within 2 hours

/** The instants a working-hours schedule produces for one local day. Pure, so it can be tested without a database. */
export function slotStartsForDay(day: Date, cfg: Pick<AvailabilityConfig, "meetingDays" | "meetingStartHour" | "meetingEndHour" | "meetingDurationMin">, tz: string): Date[] {
  const weekdays = new Set(cfg.meetingDays.split(",").map((x) => Number(x.trim())));
  if (!weekdays.has(day.getUTCDay())) return [];
  const step = Math.max(15, cfg.meetingDurationMin);
  const out: Date[] = [];
  for (let minutes = cfg.meetingStartHour * 60; minutes + step <= cfg.meetingEndHour * 60; minutes += step) {
    out.push(zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(minutes / 60), minutes % 60, tz));
  }
  return out;
}

/**
 * Creates open slots for the local days not yet generated, up to the horizon.
 * Safe to call on every inbound message: a compare-and-set on
 * meetingSlotsThrough means only one concurrent caller generates a given day,
 * and a day is generated once -- so a slot the owner deletes to block time is
 * not brought back.
 */
export async function ensureMeetingSlots(tx: Prisma.TransactionClient, tenantId: string, cfg: AvailabilityConfig, tz: string, now = new Date()): Promise<void> {
  if (!cfg.meetingAutoSlots) return;
  const today = localDateOf(now, tz);
  const last = new Date(today.getTime() + (Math.max(1, cfg.meetingHorizonDays) - 1) * 86_400_000);
  const from = cfg.meetingSlotsThrough ? new Date(Math.max(cfg.meetingSlotsThrough.getTime() + 86_400_000, today.getTime())) : today;
  if (from.getTime() > last.getTime()) return;

  const claimed = await tx.aiSettings.updateMany({
    where: { tenantId, meetingSlotsThrough: cfg.meetingSlotsThrough },
    data: { meetingSlotsThrough: last },
  });
  if (claimed.count === 0) return; // another request generated these days first

  const rows: { tenantId: string; startsAt: Date; endsAt: Date }[] = [];
  for (let day = from; day.getTime() <= last.getTime(); day = new Date(day.getTime() + 86_400_000)) {
    for (const startsAt of slotStartsForDay(day, cfg, tz)) {
      if (startsAt.getTime() < now.getTime() + MIN_LEAD_MS) continue;
      rows.push({ tenantId, startsAt, endsAt: new Date(startsAt.getTime() + cfg.meetingDurationMin * 60_000) });
    }
  }
  if (rows.length === 0) return;

  // Skip times that already have a slot (e.g. one the owner added by hand).
  const existing = await tx.meetingSlot.findMany({
    where: { tenantId, startsAt: { in: rows.map((r) => r.startsAt) } },
    select: { startsAt: true },
  });
  const taken = new Set(existing.map((e) => e.startsAt.getTime()));
  const fresh = rows.filter((r) => !taken.has(r.startsAt.getTime()));
  if (fresh.length > 0) await tx.meetingSlot.createMany({ data: fresh });
}

/**
 * At most `perDay` slots per local day, spread across that day (morning, midday, afternoon) rather than the first
 * three, and soonest days first -- so the AI can offer real choices across several days instead of 9 slots from
 * tomorrow morning.
 */
export function spreadAcrossDays<T extends { startsAt: Date }>(slots: T[], tz: string, perDay = 3, total = 9): T[] {
  const byDay = new Map<number, T[]>();
  for (const s of slots) {
    const key = localDateOf(s.startsAt, tz).getTime();
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const out: T[] = [];
  for (const key of [...byDay.keys()].sort((a, b) => a - b)) {
    const day = byDay.get(key)!;
    const picks = day.length <= perDay ? day : Array.from({ length: perDay }, (_, i) => day[Math.round((i * (day.length - 1)) / (perDay - 1))]);
    for (const p of picks) {
      if (out.length >= total) return out;
      out.push(p);
    }
  }
  return out;
}
