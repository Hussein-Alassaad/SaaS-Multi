import { describe, it, expect } from "vitest";
import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows requests up to the limit, then blocks", () => {
    const key = `test-${Math.random()}`;
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);
    expect(rateLimit(key, 3, 60_000).ok).toBe(true);

    const fourth = rateLimit(key, 3, 60_000);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", async () => {
    const key = `test-${Math.random()}`;
    expect(rateLimit(key, 1, 50).ok).toBe(true);
    expect(rateLimit(key, 1, 50).ok).toBe(false);

    await new Promise((r) => setTimeout(r, 60));

    expect(rateLimit(key, 1, 50).ok).toBe(true);
  });

  it("tracks separate keys independently", () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    expect(rateLimit(keyA, 1, 60_000).ok).toBe(true);
    expect(rateLimit(keyA, 1, 60_000).ok).toBe(false);
    expect(rateLimit(keyB, 1, 60_000).ok).toBe(true);
  });
});
