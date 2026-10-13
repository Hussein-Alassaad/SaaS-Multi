"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import Link from "next/link";
import { createMeetingSlotAction, deleteMeetingSlotAction, approveMeetingRequestAction, rejectMeetingRequestAction } from "@/lib/actions/agency-meetings";
import { AvailabilityCard, type Availability } from "./AvailabilityCard";
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
  conversationId: string;
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

export function MeetingsClient({
  slots,
  requests,
  lang,
  timezone,
  availability,
}: {
  slots: Slot[];
  requests: MeetingRequestRow[];
  lang: UiLanguage;
  timezone: string;
  availability: Availability;
}) {
  const t = getDictionary(lang);
  const ar = lang === "AR";
  // Times are shown in the business's timezone (Settings > Localization), the same one the AI quotes to customers.
  const formatDateTime = (iso: string) =>
    new Intl.DateTimeFormat(ar ? "ar-u-nu-latn" : "en-GB", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  const waiting = requests.filter((r) => r.status === "PENDING_APPROVAL");
  const [notice, setNotice] = useState<string | null>(null);
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

  const decide = (id: string, approve: boolean) => {
    setNotice(null);
    startTransition(async () => {
      const res = approve ? await approveMeetingRequestAction(id) : await rejectMeetingRequestAction(id);
      if (res.ok && approve && "customerNotified" in res) {
        setNotice(
          res.customerNotified
            ? ar ? "تم التأكيد وإرسال الموعد للزبون." : "Confirmed, and the customer was sent the time."
            : ar ? "تم التأكيد، لكن تعذّر إرسال الرسالة للزبون. راسله بنفسك." : "Confirmed, but the message to the customer could not be sent. Message them yourself."
        );
      } else if (!res.ok) {
        setNotice(res.error);
      }
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

      {notice && <p className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-2)]">{notice}</p>}

      {waiting.length > 0 && (
        <Card padding="md" className="border-[var(--status-warm)]/50 bg-[var(--status-warm)]/5">
          <CardHeader>
            <div>
              <CardTitle>{ar ? `بانتظار تأكيدك (${waiting.length})` : `Waiting for your confirmation (${waiting.length})`}</CardTitle>
              <CardDescription>
                {ar ? "عُرض هذا الوقت على الزبون. التأكيد يرسل له رسالة بالموعد." : "The customer was offered this time. Confirming sends them the booking."}
              </CardDescription>
            </div>
          </CardHeader>
          <div className="space-y-2">
            {waiting.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3">
                <div>
                  <p className="text-base font-semibold text-[var(--text-1)]">{formatDateTime(r.slotStartsAt)}</p>
                  <p className="text-xs text-[var(--text-4)]">
                    {r.clientName ?? t.meetings.unknown} · <span dir="ltr">{r.clientPhone ?? (ar ? "الرقم غير معروف بعد" : "number not given yet")}</span> · {t.channel[r.channelProvider as keyof typeof t.channel] ?? r.channelProvider} ·{" "}
                    <Link className="underline" href={`/agency/inbox?conversation=${r.conversationId}`}>
                      {ar ? "فتح المحادثة" : "Open chat"}
                    </Link>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={pending} onClick={() => decide(r.id, true)}>
                    {ar ? "تأكيد" : "Confirm"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(r.id, false)}>
                    {ar ? "رفض" : "Decline"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <AvailabilityCard initial={availability} timezone={timezone} lang={lang} />

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
