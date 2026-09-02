/**
 * Shared by /api/extension/import-session and /api/extension/reconnect --
 * both routes receive the same raw chrome.cookies.getAll() shape from the
 * Nexaris Connect extension and need to convert it into Playwright's
 * storage_state cookie shape before forwarding to the droplet. Extracted
 * here rather than duplicated so the two routes can't silently drift on
 * this mapping.
 */

export interface ExtensionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expirationDate?: number; // chrome.cookies' field name -- seconds since epoch, absent for session cookies
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "no_restriction" | "lax" | "strict" | "unspecified";
}

const SAME_SITE_MAP: Record<string, "Strict" | "Lax" | "None"> = {
  strict: "Strict",
  lax: "Lax",
  no_restriction: "None",
  unspecified: "Lax", // Playwright requires a value; Chrome's own default behavior is Lax
};

export function toPlaywrightCookies(cookies: ExtensionCookie[]) {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    // Playwright wants epoch seconds, -1 for a session cookie (no
    // expirationDate) -- chrome.cookies already reports epoch seconds,
    // no unit conversion needed, just the session-cookie fallback.
    expires: c.expirationDate ?? -1,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: SAME_SITE_MAP[c.sameSite ?? "unspecified"],
  }));
}
