"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDateTime, timeAgo } from "@/lib/utils";
import {
  approveMessageAction,
  editAndApproveMessageAction,
  rejectMessageAction,
} from "@/lib/actions/agency-inbox";
import { approveMeetingRequestAction, rejectMeetingRequestAction } from "@/lib/actions/agency-meetings";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { Check, X, Pencil, CalendarClock, MessageSquare, CheckCircle2 } from "lucide-react";

interface PendingMessage {
  id: string;
  body: string;
  language: string;
  createdAt: string;
  client: { name: string | null; phone: string | null };
  channel: { provider: string };
}

interface PendingMeeting {
  id: string;
  slotStartsAt: string;
  slotEndsAt: string;
  createdAt: string;
  client: { name: string | null; phone: string | null };
  channel: { provider: string };
}

export function ApprovalsClient({ messages, meetings, lang }: { messages: PendingMessage[]; meetings: PendingMeeting[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const total = messages.length + meetings.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.approvals.title}</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          {t.approvals.subtitle}
        </p>
      </div>

      {total === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle2 className="mb-3 h-8 w-8 text-[var(--text-5)]" />
          <p className="text-sm text-[var(--text-4)]">{t.approvals.empty}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <MessageApprovalCard key={m.id} message={m} lang={lang} />
          ))}
          {meetings.map((r) => (
            <MeetingApprovalCard key={r.id} meeting={r} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageApprovalCard({ message, lang }: { message: PendingMessage; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(message.body);
  const [pending, startTransition] = useTransition();

  const handleApprove = () => {
    startTransition(async () => {
      await approveMessageAction(message.id);
      router.refresh();
    });
  };

  const handleReject = () => {
    startTransition(async () => {
      await rejectMessageAction(message.id);
      router.refresh();
    });
  };

  const handleEditApprove = () => {
    startTransition(async () => {
      await editAndApproveMessageAction(message.id, editedBody);
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-[var(--text-4)]" />
          <div>
            <p className="text-sm font-medium text-[var(--text-1)]">
              {message.client.name ?? message.client.phone ?? t.approvals.unknown}
            </p>
            <p className="text-xs text-[var(--text-5)]">
              {t.channel[message.channel.provider as keyof typeof t.channel] ?? message.channel.provider} · {timeAgo(message.createdAt)}
            </p>
          </div>
        </div>
        <Badge variant="warm">{t.approvals.needsApproval}</Badge>
      </div>

      <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3" dir={message.language === "AR" ? "rtl" : "ltr"}>
        {editing ? (
          <textarea
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            rows={3}
            className="flex w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] outline-none"
          />
        ) : (
          <p className="text-sm text-[var(--text-1)]">{message.body}</p>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        {editing ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={pending}>
              {t.approvals.cancel}
            </Button>
            <Button size="sm" onClick={handleEditApprove} disabled={pending}>
              <Check className="h-3.5 w-3.5" />
              {t.approvals.saveAndSend}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={handleReject} disabled={pending}>
              <X className="h-3.5 w-3.5" />
              {t.approvals.reject}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={pending}>
              <Pencil className="h-3.5 w-3.5" />
              {t.approvals.edit}
            </Button>
            <Button size="sm" onClick={handleApprove} disabled={pending}>
              <Check className="h-3.5 w-3.5" />
              {t.approvals.approveAndSend}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function MeetingApprovalCard({ meeting, lang }: { meeting: PendingMeeting; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleApprove = () => {
    startTransition(async () => {
      await approveMeetingRequestAction(meeting.id);
      router.refresh();
    });
  };

  const handleReject = () => {
    startTransition(async () => {
      await rejectMeetingRequestAction(meeting.id);
      router.refresh();
    });
  };

  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-[var(--text-4)]" />
          <div>
            <p className="text-sm font-medium text-[var(--text-1)]">
              {meeting.client.name ?? meeting.client.phone ?? t.approvals.unknown} {t.approvals.wantsMeeting}
            </p>
            <p className="text-xs text-[var(--text-5)]">
              {t.channel[meeting.channel.provider as keyof typeof t.channel] ?? meeting.channel.provider} · {t.approvals.requested} {timeAgo(meeting.createdAt)}
            </p>
          </div>
        </div>
        <Badge variant="warm">{t.approvals.needsApproval}</Badge>
      </div>

      <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3">
        <p className="text-sm text-[var(--text-1)]">
          {formatDateTime(meeting.slotStartsAt)} – {formatDateTime(meeting.slotEndsAt)}
        </p>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleReject} disabled={pending}>
          <X className="h-3.5 w-3.5" />
          {t.approvals.reject}
        </Button>
        <Button size="sm" onClick={handleApprove} disabled={pending}>
          <Check className="h-3.5 w-3.5" />
          {t.approvals.approve}
        </Button>
      </div>
    </Card>
  );
}
