"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Avatar } from "@/components/ui/Avatar";
import { formatDate, formatDateTime, cn } from "@/lib/utils";
import { updateClientTagAction, updateClientNotesAction } from "@/lib/actions/agency-inbox";
import { getDictionary, isRtl, type UiLanguage } from "@/lib/i18n";
import { ArrowLeft, ArrowRight, MessageSquare, CalendarClock } from "lucide-react";

interface ClientMessage {
  id: string;
  sender: string;
  body: string;
  language: string;
  createdAt: string;
}
interface ClientConversation {
  id: string;
  stage: string;
  channel: { provider: string };
  messages: ClientMessage[];
}
interface ClientMeetingRequest {
  id: string;
  status: string;
  slotStartsAt: string;
}
interface ClientDetail {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  needs: string | null;
  tag: string;
  notes: string | null;
  createdAt: string;
  conversations: ClientConversation[];
  meetingRequests: ClientMeetingRequest[];
}

const CLIENT_TAGS = ["REPLIED", "INTERESTED", "NOT_RESPONDING", "LOST", "CONVERTED"] as const;

export function ClientDetailClient({ client, lang }: { client: ClientDetail; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const rtl = isRtl(lang);
  const router = useRouter();
  const [tag, setTag] = useState(client.tag);
  const [notes, setNotes] = useState(client.notes ?? "");
  const [pending, startTransition] = useTransition();

  const handleTagChange = (v: string) => {
    setTag(v);
    startTransition(async () => {
      await updateClientTagAction(client.id, v);
      router.refresh();
    });
  };

  const handleSaveNotes = () => {
    startTransition(async () => {
      await updateClientNotesAction(client.id, notes);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/agency/clients")}>
          {rtl ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
        </Button>
        <Avatar name={client.name ?? client.phone ?? "?"} size="lg" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-1)] truncate">
            {client.name ?? t.clientDetail.unknown}
          </h1>
          <p className="text-sm text-[var(--text-4)]">
            {client.phone ?? client.email ?? "—"} · {t.clientDetail.since} {formatDate(client.createdAt)}
          </p>
        </div>
        <Select
          value={tag}
          onValueChange={handleTagChange}
          options={CLIENT_TAGS.map((tagKey) => ({ value: tagKey, label: t.tag[tagKey] }))}
          className="w-40"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.clientDetail.details}</CardTitle>
          </CardHeader>
          <dl className="space-y-2 text-sm">
            <Row label={t.clientDetail.phone} value={client.phone ?? "—"} />
            <Row label={t.clientDetail.email} value={client.email ?? "—"} />
            <Row label={t.clientDetail.company} value={client.company ?? "—"} />
            <Row label={t.clientDetail.needs} value={client.needs ?? t.clientDetail.needsNotCollected} />
          </dl>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.clientDetail.notes}</CardTitle>
          </CardHeader>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t.clientDetail.notesPlaceholder}
            rows={4}
            className="flex w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-5)] outline-none"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={pending} onClick={handleSaveNotes}>
              {t.clientDetail.saveNotes}
            </Button>
          </div>
        </Card>
      </div>

      {client.meetingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t.clientDetail.meetingRequests}</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {client.meetingRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-3.5 w-3.5 text-[var(--text-4)]" />
                  <span className="text-[var(--text-2)]">{formatDateTime(r.slotStartsAt)}</span>
                </div>
                <Badge variant={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "hot" : "warm"}>
                  {r.status.replace(/_/g, " ")}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t.clientDetail.conversationHistory}</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          {client.conversations.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--text-4)]">{t.clientDetail.noConversations}</p>
          )}
          {client.conversations.map((conv) => (
            <div key={conv.id} className="rounded-lg border border-[var(--border-hairline)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-[var(--text-4)]" />
                <Badge variant="outline">{t.channel[conv.channel.provider as keyof typeof t.channel] ?? conv.channel.provider}</Badge>
                <Badge variant="accent">{t.stage[conv.stage as keyof typeof t.stage] ?? conv.stage.replace(/_/g, " ")}</Badge>
              </div>
              <div className="space-y-2">
                {conv.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn("flex flex-col gap-0.5", m.sender === "CUSTOMER" ? "items-start" : "items-end")}
                    dir={m.language === "AR" ? "rtl" : "ltr"}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] rounded-lg px-2.5 py-1.5 text-xs",
                        m.sender === "CUSTOMER" ? "bg-[var(--surface-2)] text-[var(--text-1)]" : "bg-accent-gradient text-white"
                      )}
                    >
                      {m.body}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-hairline)] py-1.5 last:border-0">
      <dt className="text-[var(--text-4)]">{label}</dt>
      <dd className="text-[var(--text-1)] font-medium">{value}</dd>
    </div>
  );
}
