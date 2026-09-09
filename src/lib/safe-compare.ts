import { timingSafeEqual } from "crypto";

/**
 * Constant-time secret comparison for shared-secret auth checks (cron
 * endpoints, webhook headers). Plain `===`/`!==` on secrets short-circuits
 * on the first differing byte, which is exactly the timing side-channel
 * timingSafeEqual exists to close. Handles the length mismatch case itself
 * (timingSafeEqual throws if buffers differ in length) by comparing against
 * a same-length dummy first, so returning early on length still doesn't
 * leak anything beyond "the lengths differ", not which prefix matched.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
