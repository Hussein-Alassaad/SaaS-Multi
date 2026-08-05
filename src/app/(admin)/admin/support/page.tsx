import { getSupportTickets } from "@/lib/mock/support";
import { SupportTicketsClient } from "./SupportTicketsClient";
import { KpiCard } from "@/components/ui/KpiCard";
import { Inbox, Clock, CheckCircle2, AlertTriangle } from "lucide-react";

export default async function SupportPage() {
  const tickets = await getSupportTickets();

  const open = tickets.filter((t) => t.status === "OPEN").length;
  const inProgress = tickets.filter((t) => t.status === "IN_PROGRESS").length;
  const resolved = tickets.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length;
  const urgent = tickets.filter((t) => t.priority === "URGENT" && t.status !== "CLOSED").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Support Center</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Tickets, feedback, bug reports, and feature requests across every tenant.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Open" value={open.toString()} icon={<Inbox className="h-3.5 w-3.5" />} />
        <KpiCard label="In Progress" value={inProgress.toString()} icon={<Clock className="h-3.5 w-3.5" />} />
        <KpiCard label="Resolved" value={resolved.toString()} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
        <KpiCard label="Urgent" value={urgent.toString()} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
      </div>

      <SupportTicketsClient
        tickets={tickets.map((t) => ({
          id: t.id,
          subject: t.subject,
          tenantName: t.tenant.companyName,
          type: t.type,
          priority: t.priority,
          status: t.status,
          assigneeName: t.assignee?.name ?? null,
          createdAt: t.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
