import { describe, it, expect } from "vitest";
import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows requests up to the limit, then blocks", async () => {
    const key = `test-${Math.random()}`;
    expect((await rateLimit(key, 3, 60_000)).ok).toBe(true);
    expect((await rateLimit(key, 3, 60_000)).ok).toBe(true);
    expect((await rateLimit(key, 3, 60_000)).ok).toBe(true);

    const fourth = await rateLimit(key, 3, 60_000);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", async () => {
    // Window widened well beyond an earlier 50ms/300ms pairing: with
    // UPSTASH_REDIS_REST_URL configured, rateLimit() makes a real network
    // round-trip to Upstash per call, and that round-trip time (plus
    // jitter) can itself approach or exceed a short window, making the
    // "still blocked" assertion flaky. A window measured in seconds keeps
    // the two before-expiry calls unambiguously within it regardless of
    // request latency, while the sleep-past-expiry margin stays proportional.
    const key = `test-${Math.random()}`;
    expect((await rateLimit(key, 1, 2000)).ok).toBe(true);
    expect((await rateLimit(key, 1, 2000)).ok).toBe(false);

    await new Promise((r) => setTimeout(r, 2500));

    expect((await rateLimit(key, 1, 2000)).ok).toBe(true);
  });

  it("tracks separate keys independently", async () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    expect((await rateLimit(keyA, 1, 60_000)).ok).toBe(true);
    expect((await rateLimit(keyA, 1, 60_000)).ok).toBe(false);
    expect((await rateLimit(keyB, 1, 60_000)).ok).toBe(true);
  });
});
