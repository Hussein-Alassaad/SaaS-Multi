/**
 * IPv4 CIDR matching for the tenant IP allowlist (Marketing -> Security page).
 * Deliberately IPv4-only and dependency-free -- good enough for the office/
 * VPN-egress-IP allowlisting this feature targets; an IPv6 client address
 * simply never matches any entry (same as "no entries" -- see callers, which
 * treat that as failing OPEN, not blocking the login).
 */

function parseIpv4(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

/** `entry` is either a bare IPv4 address (treated as /32) or a CIDR range like "203.0.113.0/24". */
export function ipMatchesCidr(ip: string, entry: string): boolean {
  const [rangeIp, prefixStr] = entry.split("/");
  const ipNum = parseIpv4(ip);
  const rangeNum = parseIpv4(rangeIp);
  if (ipNum === null || rangeNum === null) return false;

  const prefix = prefixStr === undefined ? 32 : Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  if (prefix === 0) return true;

  const mask = prefix === 32 ? 0xffffffff : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

export function ipMatchesAnyCidr(ip: string | null, entries: string[]): boolean {
  if (!ip) return false;
  return entries.some((entry) => ipMatchesCidr(ip, entry));
}
