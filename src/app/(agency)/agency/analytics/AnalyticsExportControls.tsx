"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, CalendarClock, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";
import {
  getAnalyticsExportDataAction,
  scheduleReportAction,
  deleteScheduledReportAction,
  type ReportFrequency,
  type ReportType,
} from "@/lib/actions/marketing-reports";

interface ScheduledReportRow {
  id: string;
  name: string;
  frequency: string;
  recipients: string[];
  reportType: string;
  nextRunAt: string;
}

const FREQUENCY_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];
const REPORT_TYPE_OPTIONS = [
  { value: "analytics", label: "Analytics" },
  { value: "campaigns", label: "Campaigns" },
  { value: "contacts", label: "Contacts" },
];

export function AnalyticsExportControls({ initialReports }: { initialReports: ScheduledReportRow[] }) {
  const router = useRouter();
  const [reports, setReports] = useState(initialReports);
  const [exporting, startExport] = useTransition();
  const [pending, startTransition] = useTransition();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", frequency: "weekly" as ReportFrequency, reportType: "analytics" as ReportType, recipients: "" });
  const [error, setError] = useState<string | null>(null);

  function handleExport() {
    startExport(async () => {
      const result = await getAnalyticsExportDataAction();
      if (!result.ok) return;
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      const { summary, tenantName } = result;

      doc.setFontSize(16);
      doc.text(`Analytics report${tenantName ? ` — ${tenantName}` : ""}`, 14, 18);
      doc.setFontSize(10);
      doc.text(new Date().toLocaleDateString(), 14, 25);

      const rows: [string, string][] = [
        ["Total conversations", String(summary.totalConversations)],
        ["Total messages", String(summary.totalMessages)],
        ["Response rate", `${summary.responseRate}%`],
        ["Qualification rate", `${summary.qualificationRate}%`],
        ["Meeting conversion rate", `${summary.meetingConversionRate}%`],
        ["Won rate", `${summary.wonRate}%`],
      ];

      let y = 38;
      doc.setFontSize(12);
      doc.text("Summary", 14, y);
      y += 8;
      doc.setFontSize(10);
      for (const [label, value] of rows) {
        doc.text(label, 14, y);
        doc.text(value, 120, y);
        y += 7;
      }

      y += 6;
      doc.setFontSize(12);
      doc.text("Channel breakdown", 14, y);
      y += 8;
      doc.setFontSize(10);
      if (summary.channelBreakdown.length === 0) {
        doc.text("No conversations yet.", 14, y);
      } else {
        for (const c of summary.channelBreakdown) {
          doc.text(c.provider, 14, y);
          doc.text(`${c.count} conversations`, 120, y);
          y += 7;
        }
      }

      doc.save(`analytics-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    });
  }

  function handleSchedule() {
    setError(null);
    const recipients = form.recipients.split(",").map((r) => r.trim()).filter(Boolean);
    startTransition(async () => {
      const result = await scheduleReportAction({
        name: form.name,
        frequency: form.frequency,
        reportType: form.reportType,
        recipients,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReports((prev) => [
        {
          id: result.report.id,
          name: result.report.name,
          frequency: result.report.frequency,
          recipients,
          reportType: result.report.reportType,
          nextRunAt: result.report.nextRunAt.toISOString(),
        },
        ...prev,
      ]);
      setModalOpen(false);
      setForm({ name: "", frequency: "weekly", reportType: "analytics", recipients: "" });
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteScheduledReportAction(id);
      if (result.ok) {
        setReports((prev) => prev.filter((r) => r.id !== id));
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={exporting} onClick={handleExport}>
          <Download className="h-3.5 w-3.5" />
          {exporting ? "Preparing..." : "Export PDF"}
        </Button>
        <Button variant="outline" onClick={() => setModalOpen(true)}>
          <CalendarClock className="h-3.5 w-3.5" />
          Schedule report
        </Button>
      </div>

      {reports.length > 0 && (
        <Card padding="md">
          <CardHeader>
            <div>
              <CardTitle>Scheduled reports</CardTitle>
              <CardDescription>Recorded here; delivery automation is not wired up yet.</CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-[var(--border-hairline)] py-2.5 last:border-0">
                <div>
                  <div className="text-sm text-[var(--text-1)]">{r.name}</div>
                  <div className="text-xs text-[var(--text-5)]">
                    {r.frequency} · {r.reportType} · {r.recipients.join(", ")} · next {formatDate(r.nextRunAt)}
                  </div>
                </div>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleDelete(r.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title="Schedule a report" description="Recorded for future automation -- not sent automatically yet.">
        <div className="space-y-3">
          <Input placeholder="Report name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.frequency} onValueChange={(v) => setForm((f) => ({ ...f, frequency: v as ReportFrequency }))} options={FREQUENCY_OPTIONS} />
            <Select value={form.reportType} onValueChange={(v) => setForm((f) => ({ ...f, reportType: v as ReportType }))} options={REPORT_TYPE_OPTIONS} />
          </div>
          <Input
            placeholder="Recipient emails, comma separated"
            value={form.recipients}
            onChange={(e) => setForm((f) => ({ ...f, recipients: e.target.value }))}
          />
          {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
          <Button className="w-full" disabled={pending || !form.name.trim()} onClick={handleSchedule}>
            {pending ? "Saving..." : "Schedule"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
