import { getTenantSession } from "@/lib/auth";
import { getAccountHealthPageData } from "@/lib/outreach/accounts";
import { getEnabledSectionKeys } from "@/lib/agency/sections";
import { AccountHealthClient } from "./AccountHealthClient";

export default async function OutreachAccountsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  // The account list and its reach stats share ONE withTenant() scope (see
  // getAccountHealthPageData); the section lookup is a plain non-transactional
  // db read, so it can still run alongside it without a second transaction.
  const [{ accounts, reachStats }, enabledSections] = await Promise.all([
    getAccountHealthPageData(tenantId),
    getEnabledSectionKeys(tenantId, "outreach"),
  ]);
  // Which channels this client can create accounts for -- an Admin-side per-
  // tenant call (Sections tab on /admin/tenants/[tenantId]), not a hardcoded
  // product decision. Every client gets a different mix depending on what
  // they've actually signed up for.
  const enabledPlatforms = {
    linkedin: enabledSections.has("linkedin"),
    email: enabledSections.has("email"),
    instagram: enabledSections.has("instagram-manual"),
  };

  const serialized = accounts.map((a) => ({
    id: a.id,
    label: a.label,
    platform: a.platform,
    runTime: a.runTime,
    igDailyLimit: a.igDailyLimit,
    linkedinDailyLimit: a.linkedinDailyLimit,
    emailDailyLimit: a.emailDailyLimit,
    sentToday: reachStats.get(a.id)?.sentToday ?? 0,
    sentThisWeek: reachStats.get(a.id)?.sentThisWeek ?? 0,
    repliedThisWeek: reachStats.get(a.id)?.repliedThisWeek ?? 0,
    proxyHost: a.proxyHost,
    proxyPort: a.proxyPort,
    proxyUsername: a.proxyUsername,
    hasProxyPassword: !!a.proxyPasswordEnc,
    verifiedProxyIp: a.verifiedProxyIp,
    loginEmail: a.loginEmail,
    hasLoginPassword: !!a.loginPasswordEnc,
    loginStatus: a.loginStatus,
    loginError: a.loginError,
    loginConnectedAt: a.loginConnectedAt ? a.loginConnectedAt.toISOString() : null,
    loginConnectingAt: a.loginConnectingAt ? a.loginConnectingAt.toISOString() : null,
    sesFromEmail: a.sesFromEmail,
    sesFromName: a.sesFromName,
    warmupCurrentLimit: a.warmupCurrentLimit,
    status: a.status,
    warningType: a.warningType,
    warningReason: a.warningReason,
    redistributeFlag: a.redistributeFlag,
  }));

  return <AccountHealthClient tenantId={tenantId} initialAccounts={serialized} enabledPlatforms={enabledPlatforms} />;
}
