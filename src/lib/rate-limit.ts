import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiting backed by Upstash Redis when configured, so limits are
 * enforced correctly across multiple server instances (an in-memory-only
 * limiter gives each instance its own separate counter, which silently
 * stops working once the app runs on more than one server). Falls back to
 * a single-process in-memory limiter when Redis env vars are unset, so
 * local dev works with zero external setup -- same no-op-gracefully
 * pattern used by src/lib/email.ts and src/lib/ai/respond.ts.
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// Distinct Ratelimit instance per (limit, windowMs) pair so each call site's
// quota (e.g. signup: 5/min vs reset-request: 3/min) is tracked separately
// without the caller having to manage instances themselves.
const limiters = new Map<string, Ratelimit>();
function getLimiter(limit: number, windowMs: number): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`;
  let limiter = limiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: redis!,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      analytics: false,
    });
    limiters.set(cacheKey, limiter);
  }
  return limiter;
}

// In-memory fallback (dev / no Redis configured) -- single-process only,
// resets on restart. See module doc comment above for why this isn't used
// when Redis is available.
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();
function memoryRateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterMs: bucket.resetAt - now };
  }
  bucket.count += 1;
  return { ok: true };
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ ok: boolean; retryAfterMs?: number }> {
  if (!redis) {
    return memoryRateLimit(key, limit, windowMs);
  }

  const result = await getLimiter(limit, windowMs).limit(key);
  return {
    ok: result.success,
    retryAfterMs: result.success ? undefined : Math.max(0, result.reset - Date.now()),
  };
}

/**
 * Best-effort client IP extraction for use as a rate-limit key inside
 * server actions (which don't have direct access to the request object the
 * way middleware does — headers() from next/headers is the supported way
 * to read forwarded-for info from within an action).
 */
export async function getRequestIp(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const headerList = await headers();
    const forwardedFor = headerList.get("x-forwarded-for");
    if (forwardedFor) return forwardedFor.split(",")[0].trim();
    return headerList.get("x-real-ip") ?? "unknown";
  } catch {
    // headers() throws outside a real request scope (e.g. server actions
    // invoked directly from tests) — fall back to a constant key so
    // rate limiting still degrades safely instead of crashing the caller.
    return "unknown";
  }
}
