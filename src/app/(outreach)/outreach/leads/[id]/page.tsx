import { notFound } from "next/navigation";
import { getTenantSession } from "@/lib/auth";
import { getLeadDetail } from "@/lib/outreach/leads";
import { safeJsonParse } from "@/lib/utils";
import { LeadDetailClient } from "./LeadDetailClient";

export default async function OutreachLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const lead = await getLeadDetail(tenantId, id);
  if (!lead) notFound();

  const serializedLead = {
    id: lead.id,
    businessName: lead.businessName,
    platform: lead.platform,
    status: lead.status,
    temperature: lead.temperature,
    score: lead.score,
    industry: lead.industry,
    companySize: lead.companySize,
    revenueTier: lead.revenueTier,
    founderFound: lead.founderFound,
    founderName: lead.founderName,
    founderSourcePhrase: lead.founderSourcePhrase,
    whatsappFound: lead.whatsappFound,
    whatsappNumber: lead.whatsappNumber,
    contactEmail: lead.contactEmail,
    website: lead.website,
    profileUrl: lead.profileUrl,
    contactCount: lead.contactCount,
    weakPoints: safeJsonParse<string[]>(lead.weakPoints, []),
    aiOpportunities: safeJsonParse<string[]>(lead.aiOpportunities, []),
    scoreReasoning: lead.scoreReasoning,
    generatedMessage: lead.generatedMessage,
    messageStyleUsed: lead.messageStyleUsed,
    notes: lead.notes,
    doNotContact: lead.doNotContact,
    doNotContactReason: lead.doNotContactReason,
  };

  const history = lead.pipelineHistory.map((h) => ({
    id: h.id,
    changedAt: h.changedAt.toISOString(),
    fromStage: h.fromStage,
    toStage: h.toStage,
    changedBy: h.changedBy,
  }));

  return <LeadDetailClient lead={serializedLead} history={history} />;
}
