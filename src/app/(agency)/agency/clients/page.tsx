import { getNexarisClientsList } from "@/lib/agency/clients";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { ClientsListClient } from "./ClientsListClient";

export default async function ClientsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const { items, nextCursor } = await getNexarisClientsList(tenantId);

  const rows = items.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    company: c.company,
    tag: c.tag,
    conversationCount: c.conversations.length,
    updatedAt: c.updatedAt.toISOString(),
  }));

  return <ClientsListClient clients={rows} initialNextCursor={nextCursor} lang={lang} />;
}
