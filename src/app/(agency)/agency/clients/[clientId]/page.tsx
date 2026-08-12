import { notFound } from "next/navigation";
import { getNexarisClientDetail } from "@/lib/agency/clients";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { ClientDetailClient } from "./ClientDetailClient";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const client = await getNexarisClientDetail(tenantId, clientId);
  if (!client) notFound();

  const serialized = {
    id: client.id,
    name: client.name,
    phone: client.phone,
    email: client.email,
    company: client.company,
    needs: client.needs,
    tag: client.tag,
    notes: client.notes,
    createdAt: client.createdAt.toISOString(),
    conversations: client.conversations.map((c) => ({
      id: c.id,
      stage: c.stage,
      channel: { provider: c.channel.provider },
      messages: c.messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        body: m.body,
        language: m.language,
        createdAt: m.createdAt.toISOString(),
      })),
    })),
    meetingRequests: client.meetingRequests.map((r) => ({
      id: r.id,
      status: r.status,
      slotStartsAt: r.slot.startsAt.toISOString(),
    })),
  };

  return <ClientDetailClient client={serialized} lang={lang} />;
}
