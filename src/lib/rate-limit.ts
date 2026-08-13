/**
 * In-memory token-bucket rate limiter. Single-process only — resets on
 * server restart and does not coordinate across multiple instances. That's
 * an acceptable tradeoff for the current single-server deployment; if this
 * app is ever scaled horizontally, replace with a shared store (e.g. Redis).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { ok: true };
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
