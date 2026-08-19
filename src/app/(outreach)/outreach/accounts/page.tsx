import { getTenantSession } from "@/lib/auth";
import { getAccountsList } from "@/lib/outreach/accounts";
import { AccountHealthClient } from "./AccountHealthClient";

export default async function OutreachAccountsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const accounts = await getAccountsList(tenantId);

  const serialized = accounts.map((a) => ({
    id: a.id,
    label: a.label,
    platform: a.platform,
    runTime: a.runTime,
    igDailyLimit: a.igDailyLimit,
    linkedinDailyLimit: a.linkedinDailyLimit,
    emailDailyLimit: a.emailDailyLimit,
    proxyHost: a.proxyHost,
    proxyPort: a.proxyPort,
    proxyUsername: a.proxyUsername,
    hasProxyPassword: !!a.proxyPasswordEnc,
    sesFromEmail: a.sesFromEmail,
    sesFromName: a.sesFromName,
    warmupCurrentLimit: a.warmupCurrentLimit,
    status: a.status,
    warningType: a.warningType,
    warningReason: a.warningReason,
    redistributeFlag: a.redistributeFlag,
  }));

  return <AccountHealthClient tenantId={tenantId} initialAccounts={serialized} />;
}
