import { describe, it, expect } from "vitest";
import { zonedTimeToUtc, parseLocalInput, formatSlotLabel, slotStartsForDay, spreadAcrossDays, safeTimezone, localDateOf } from "@/lib/agency/slots";

describe("timezone conversion", () => {
  it("reads 3 pm in Beirut as 12:00 UTC in October (summer time) and 13:00 UTC in December", () => {
    expect(zonedTimeToUtc(2026, 10, 14, 15, 0, "Asia/Beirut").toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(zonedTimeToUtc(2026, 12, 1, 15, 0, "Asia/Beirut").toISOString()).toBe("2026-12-01T13:00:00.000Z");
  });
  it("handles a western timezone and plain UTC", () => {
    expect(zonedTimeToUtc(2026, 7, 1, 9, 30, "America/New_York").toISOString()).toBe("2026-07-01T13:30:00.000Z");
    expect(zonedTimeToUtc(2026, 7, 1, 9, 30, "UTC").toISOString()).toBe("2026-07-01T09:30:00.000Z");
  });
  it("parses the datetime-local value the form sends", () => {
    expect(parseLocalInput("2026-10-14T15:00", "Asia/Beirut")?.toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(parseLocalInput("garbage", "Asia/Beirut")).toBeNull();
  });
  it("falls back to Beirut for an unknown or missing timezone instead of throwing", () => {
    expect(safeTimezone("Not/AZone")).toBe("Asia/Beirut");
    expect(safeTimezone(null)).toBe("Asia/Beirut");
    expect(safeTimezone("UTC")).toBe("UTC"); // an explicit choice is respected
  });
  it("finds the local calendar day, not the UTC one", () => {
    // 22:30 UTC on the 14th is already 01:30 on the 15th in Beirut
    expect(localDateOf(new Date("2026-10-14T22:30:00Z"), "Asia/Beirut").toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });
});

describe("formatSlotLabel", () => {
  const slot = new Date("2026-10-14T12:00:00Z"); // 3 pm in Beirut
  it("writes the local time in English", () => {
    const label = formatSlotLabel(slot, "Asia/Beirut", "EN");
    expect(label).toContain("Wednesday");
    expect(label).toContain("14 October");
    expect(label.toLowerCase()).toContain("3:00 pm");
  });
  it("writes Arabic with Western digits for Arabic-script customers", () => {
    const label = formatSlotLabel(slot, "Asia/Beirut", "AR_LB");
    expect(label).toMatch(/[؀-ۿ]/);
    expect(label).toContain("14");
    expect(label).toContain("3:00");
  });
});

describe("slotStartsForDay", () => {
  const cfg = { meetingDays: "1,2,3,4,5", meetingStartHour: 10, meetingEndHour: 12, meetingDurationMin: 30 };
  it("fills the working hours in local time on a working day", () => {
    const wed = new Date(Date.UTC(2026, 9, 14)); // Wednesday
    expect(slotStartsForDay(wed, cfg, "Asia/Beirut").map((d) => d.toISOString())).toEqual([
      "2026-10-14T07:00:00.000Z",
      "2026-10-14T07:30:00.000Z",
      "2026-10-14T08:00:00.000Z",
      "2026-10-14T08:30:00.000Z",
    ]);
  });
  it("makes nothing on a day off", () => {
    expect(slotStartsForDay(new Date(Date.UTC(2026, 9, 17)), cfg, "Asia/Beirut")).toEqual([]); // Saturday
  });
});

describe("spreadAcrossDays", () => {
  it("offers morning, midday and afternoon of each day and several days, not nine slots from one morning", () => {
    const slots = [];
    for (const day of [14, 15, 16, 17]) for (let h = 7; h < 14; h++) slots.push({ startsAt: new Date(Date.UTC(2026, 9, day, h)) });
    const picked = spreadAcrossDays(slots, "UTC", 3, 9);
    expect(picked).toHaveLength(9);
    expect(picked.slice(0, 3).map((s) => s.startsAt.getUTCHours())).toEqual([7, 10, 13]);
    expect(new Set(picked.map((s) => s.startsAt.getUTCDate())).size).toBe(3);
  });
});
