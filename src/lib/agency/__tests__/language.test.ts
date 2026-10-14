import { describe, it, expect } from "vitest";
import { isArabicScript, applyDialect, confirmationText, reminderText, type ReplyLanguage } from "@/lib/agency/language";
import { detectLanguage } from "@/lib/ai/respond";
import { formatSlotLabel, zonedTimeToUtc, safeTimezone } from "@/lib/agency/slots";

const ALL: ReplyLanguage[] = ["AR", "AR_MA", "AR_LB", "ARABIZI", "ARABIZI_MA", "FR", "EN"];

describe("direction", () => {
  it("only Arabic script is right-to-left (Arabizi is Latin letters)", () => {
    expect(ALL.filter(isArabicScript)).toEqual(["AR", "AR_MA", "AR_LB"]);
  });
});

describe("Moroccan customers", () => {
  it("recognises Darija in Arabic script", () => {
    expect(detectLanguage("بغيت نعرف شحال الثمن ديال الخدمة")).toBe("AR_MA");
    expect(detectLanguage("سلام، واش كاين شي موعد؟")).toBe("AR_MA");
  });
  it("recognises Darija in Latin letters, even with a French word in it", () => {
    expect(detectLanguage("salam bghit n3rf chhal taman dyal logo")).toBe("ARABIZI_MA");
    expect(detectLanguage("wakha, bghit rendez-vous demain")).toBe("ARABIZI_MA");
  });
  it("recognises French", () => {
    expect(detectLanguage("Bonjour, je voudrais un rendez-vous")).toBe("FR");
    expect(detectLanguage("Combien coûte un logo ?")).toBe("FR");
    expect(detectLanguage("Merci, vous êtes disponibles demain ?")).toBe("FR");
  });
  it("a bare greeting is generic Arabizi, not forced into one dialect", () => {
    expect(detectLanguage("salam")).toBe("ARABIZI");
  });
  it("generic Arabic greetings no longer make a Moroccan customer Lebanese", () => {
    expect(detectLanguage("مرحبا")).toBe("AR");
    expect(detectLanguage("ماشي مشكل")).toBe("AR_MA");
  });
  it("plain English stays English", () => {
    expect(detectLanguage("Hi, what are your opening hours?")).toBe("EN");
  });
});

describe("dialect setting", () => {
  it("Moroccan setting settles ambiguous Arabic, but never changes French or English", () => {
    expect(applyDialect("AR", "MOROCCAN")).toBe("AR_MA");
    expect(applyDialect("ARABIZI", "MOROCCAN")).toBe("ARABIZI_MA");
    expect(applyDialect("AR_LB", "MOROCCAN")).toBe("AR_MA");
    expect(applyDialect("FR", "MOROCCAN")).toBe("FR");
    expect(applyDialect("EN", "MOROCCAN")).toBe("EN");
  });
  it("Lebanese setting and Automatic behave the other way / not at all", () => {
    expect(applyDialect("AR", "LEBANESE")).toBe("AR_LB");
    expect(applyDialect("AR_MA", "LEBANESE")).toBe("AR_LB");
    expect(applyDialect("AR", "AUTO")).toBe("AR");
    expect(applyDialect("AR", undefined)).toBe("AR");
  });
});

describe("customer messages", () => {
  it("confirmation and reminder carry the time in every language, and Arabizi is not written in Arabic script", () => {
    for (const lang of ALL) {
      expect(confirmationText(lang, "LABEL")).toContain("LABEL");
      expect(reminderText(lang, "LABEL")).toContain("LABEL");
    }
    expect(confirmationText("ARABIZI", "X")).not.toMatch(/[؀-ۿ]/);
    expect(confirmationText("ARABIZI_MA", "X")).not.toMatch(/[؀-ۿ]/);
    expect(confirmationText("FR", "X")).toContain("Votre appel est confirmé");
    expect(confirmationText("AR_MA", "X")).toMatch(/[؀-ۿ]/);
  });
});

describe("Morocco's clock", () => {
  it("is one hour ahead of UTC normally and on UTC during Ramadan", () => {
    expect(zonedTimeToUtc(2026, 10, 14, 15, 0, "Africa/Casablanca").toISOString()).toBe("2026-10-14T14:00:00.000Z");
    expect(zonedTimeToUtc(2026, 3, 1, 15, 0, "Africa/Casablanca").toISOString()).toBe("2026-03-01T15:00:00.000Z");
  });
  it("is the default when a workspace has no timezone saved", () => {
    expect(safeTimezone(null)).toBe("Africa/Casablanca");
    expect(safeTimezone("Not/AZone")).toBe("Africa/Casablanca");
  });
  it("writes the time in French for a French customer, 24-hour", () => {
    const label = formatSlotLabel(new Date("2026-10-14T14:00:00Z"), "Africa/Casablanca", "FR");
    expect(label).toContain("mercredi");
    expect(label).toContain("octobre");
    expect(label).toContain("15:00");
  });
});
