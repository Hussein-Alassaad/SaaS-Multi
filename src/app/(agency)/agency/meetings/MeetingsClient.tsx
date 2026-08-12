"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/utils";
import { createMeetingSlotAction, deleteMeetingSlotAction } from "@/lib/actions/agency-meetings";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { Plus, Trash2 } from "lucide-react";

interface Slot {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  clientName: string | null;
}
interface MeetingRequestRow {
  id: string;
  status: string;
  slotStartsAt: string;
  clientName: string | null;
  clientPhone: string | null;
  channelProvider: string;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, "neutral" | "warm" | "success" | "hot"> = {
  PENDING_APPROVAL: "warm",
  APPROVED: "success",
  REJECTED: "hot",
  COMPLETED: "success",
  CANCELED: "hot",
};

export function MeetingsClient({ slots, requests, lang }: { slots: Slot[]; requests: MeetingRequestRow[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ startsAt: "", durationMin: "30" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleAddSlot = () => {
    if (!form.startsAt) {
      setError(t.meetings.requiredDateTime);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createMeetingSlotAction(form.startsAt, Number(form.durationMin) || 30);
      if (!result.ok) {
        setError(result.error ?? "Failed to add slot.");
        return;
      }
      setForm({ startsAt: "", durationMin: "30" });
      setModalOpen(false);
      router.refresh();
    });
  };

  const handleDeleteSlot = (id: string) => {
    startTransition(async () => {
      await deleteMeetingSlotAction(id);
      router.refresh();
    });
  };

  const requestColumns: Column<MeetingRequestRow>[] = [
    { key: "client", header: t.meetings.colClient, render: (r) => r.clientName ?? r.clientPhone ?? t.meetings.unknown },
    { key: "time", header: t.meetings.colRequestedTime, render: (r) => formatDateTime(r.slotStartsAt) },
    { key: "channel", header: t.meetings.colChannel, render: (r) => <Badge variant="outline">{t.channel[r.channelProvider as keyof typeof t.channel] ?? r.channelProvider}</Badge> },
    {
      key: "status",
      header: t.meetings.colStatus,
      render: (r) => <Badge variant={STATUS_VARIANT[r.status] ?? "neutral"}>{r.status.replace(/_/g, " ")}</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.meetings.title}</h1>
          <p className="text-sm text-[var(--text-4)] mt-1">
            {t.meetings.subtitle}
          </p>
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {t.meetings.addTimeSlot}
        </Button>
      </div>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>{t.meetings.availableSlots}</CardTitle>
            <CardDescription>{t.meetings.availableSlotsSubtitle}</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-2">
          {slots.filter((s) => s.status !== "BOOKED").length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-4)]">{t.meetings.noOpenSlots}</p>
          ) : (
            slots
              .filter((s) => s.status !== "BOOKED")
              .map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-[var(--border-hairline)] p-2.5">
                  <span className="text-sm text-[var(--text-2)]">{formatDateTime(s.startsAt)}</span>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteSlot(s.id)} disabled={pending}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
          )}
        </div>
      </Card>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>{t.meetings.bookedMeetings}</CardTitle>
            <CardDescription>{t.meetings.bookedMeetingsSubtitle}</CardDescription>
          </div>
        </CardHeader>
        <DataTable columns={requestColumns} data={requests} rowKey={(r) => r.id} emptyMessage={t.meetings.noMeetingRequests} />
      </Card>

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={t.meetings.modalTitle}>
        <div className="space-y-3">
          <Input
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
          />
          <Input
            type="number"
            placeholder={t.meetings.durationPlaceholder}
            value={form.durationMin}
            onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))}
          />
          {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
          <Button className="w-full" disabled={pending} onClick={handleAddSlot}>
            {pending ? t.meetings.adding : t.meetings.addSlot}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
