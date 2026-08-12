import { getKnowledgeEntries } from "@/lib/agency/knowledge";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { KnowledgeBaseClient } from "./KnowledgeBaseClient";

export default async function KnowledgeBasePage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const entries = await getKnowledgeEntries(tenantId);

  const rows = entries.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    body: e.body,
    addedByName: e.addedBy?.name ?? null,
    updatedAt: e.updatedAt.toISOString(),
  }));

  return <KnowledgeBaseClient entries={rows} lang={lang} />;
}
