import { describe, it, expect } from "vitest";
import { selectKnowledge } from "@/lib/ai/knowledge";
import { detectLanguage } from "@/lib/ai/respond";

describe("selectKnowledge", () => {
  const entries = [
    { title: "Opening hours", body: "We are open Monday to Friday 9am to 6pm." },
    { title: "Logo design pricing", body: "A logo package starts at 300 dollars." },
    { title: "Website development", body: "We build websites in Next.js." },
    { title: "Refund policy", body: "Refunds within 14 days." },
  ];

  it("puts the entry that matches the question first", () => {
    const picked = selectKnowledge(entries, "how much for a logo?", 2);
    expect(picked[0].title).toBe("Logo design pricing");
    expect(picked).toHaveLength(2);
  });

  it("still returns the basics when nothing matches", () => {
    expect(selectKnowledge(entries, "hello", 2).map((e) => e.title)).toEqual(["Opening hours", "Logo design pricing"]);
  });

  it("caps total size but always keeps the best entry", () => {
    const big = [{ title: "Huge", body: "x".repeat(9000) }, { title: "Small", body: "small" }];
    const picked = selectKnowledge(big, "huge", 8, 6000);
    expect(picked[0].title).toBe("Huge");
    expect(picked).toHaveLength(1);
  });

  it("handles an empty knowledge base", () => {
    expect(selectKnowledge([], "anything")).toEqual([]);
  });
});

describe("detectLanguage", () => {
  it("recognises Lebanese Arabic script", () => {
    expect(detectLanguage("مرحبا، شو بدي أعمل لحجز موعد؟")).toBe("AR_LB");
  });
  it("recognises Moroccan Darija", () => {
    expect(detectLanguage("بغيت نعرف شحال ديال الثمن")).toBe("AR_MA");
  });
  it("falls back to Modern Standard Arabic", () => {
    expect(detectLanguage("أريد معرفة الأسعار")).toBe("AR");
  });
  it("recognises Arabizi", () => {
    expect(detectLanguage("kifak habibi, bade se3er el logo")).toBe("ARABIZI");
    expect(detectLanguage("shu el se3er?")).toBe("ARABIZI");
  });
  it("treats plain English as English", () => {
    expect(detectLanguage("Hi, what are your opening hours?")).toBe("EN");
  });
});
