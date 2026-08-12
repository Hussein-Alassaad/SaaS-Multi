"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { timeAgo, cn } from "@/lib/utils";
import { simulateInboundMessageAction } from "@/lib/actions/agency-inbox";
import { getConversationThreadAction } from "@/lib/actions/agency-conversations";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { Plus, MessageCircle } from "lucide-react";

interface ConversationRow {
  id: string;
  stage: string;
  status: string;
  language: string;
  lastMessageAt: string;
  channel: { provider: string };
  client: { id: string; name: string | null; phone: string | null };
  lastMessage: { body: string; sender: string; status: string } | null;
}

interface ThreadMessage {
  id: string;
  sender: string;
  body: string;
  language: string;
  status: string;
  createdAt: string;
}

interface ThreadData {
  id: string;
  stage: string;
  status: string;
  language: string;
  channel: { provider: string };
  client: { id: string; name: string | null; phone: string | null };
  messages: ThreadMessage[];
}

const STAGE_VARIANT: Record<string, "neutral" | "warm" | "accent" | "success" | "hot"> = {
  NEW: "neutral",
  CONTACTED: "accent",
  INTERESTED: "warm",
  MEETING_PENDING: "warm",
  MEETING_BOOKED: "success",
  WON: "success",
  LOST: "hot",
};

export function InboxClient({ conversations, lang }: { conversations: ConversationRow[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("conversation"));
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [loadingThread, startThreadTransition] = useTransition();
  const [simulateOpen, setSimulateOpen] = useState(false);

  const loadThread = useCallback((id: string) => {
    startThreadTransition(async () => {
      const result = await getConversationThreadAction(id);
      if (result.ok) setThread(result.conversation);
    });
  }, []);

  useEffect(() => {
    if (selectedId) loadThread(selectedId);
  }, [selectedId, loadThread]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    router.replace(`/agency/inbox?conversation=${id}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.inbox.title}</h1>
          <p className="text-sm text-[var(--text-4)] mt-1">
            {t.inbox.subtitle}
          </p>
        </div>
        <Button size="sm" onClick={() => setSimulateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {t.inbox.simulateIncoming}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        <Card padding="sm" className="max-h-[70vh] overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <MessageCircle className="mb-3 h-8 w-8 text-[var(--text-5)]" />
              <p className="text-sm text-[var(--text-4)]">{t.inbox.noConversations}</p>
              <p className="mt-1 text-xs text-[var(--text-5)]">{t.inbox.simulateHint}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelect(c.id)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg p-2.5 text-start transition-colors",
                    selectedId === c.id ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]/60"
                  )}
                >
                  <Avatar name={c.client.name ?? c.client.phone ?? "?"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-[var(--text-1)]">
                        {c.client.name ?? c.client.phone ?? t.inbox.unknown}
                      </p>
                      <span className="shrink-0 text-[10px] text-[var(--text-5)]">{timeAgo(c.lastMessageAt)}</span>
                    </div>
                    <p className="truncate text-xs text-[var(--text-4)]">{c.lastMessage?.body ?? "—"}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge variant="outline">{t.channel[c.channel.provider as keyof typeof t.channel] ?? c.channel.provider}</Badge>
                      <Badge variant={STAGE_VARIANT[c.stage] ?? "neutral"}>{t.stage[c.stage as keyof typeof t.stage] ?? c.stage.replace(/_/g, " ")}</Badge>
                      {c.lastMessage?.status === "PENDING_APPROVAL" && <Badge variant="warm">{t.inbox.needsApproval}</Badge>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card padding="md" className="min-h-[50vh]">
          {!selectedId ? (
            <div className="flex h-full min-h-[45vh] flex-col items-center justify-center text-center">
              <MessageCircle className="mb-3 h-8 w-8 text-[var(--text-5)]" />
              <p className="text-sm text-[var(--text-4)]">{t.inbox.selectConversation}</p>
            </div>
          ) : loadingThread || !thread ? (
            <p className="py-12 text-center text-sm text-[var(--text-4)]">{t.inbox.loading}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-hairline)] pb-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={thread.client.name ?? thread.client.phone ?? "?"} size="md" />
                  <div>
                    <p className="text-sm font-medium text-[var(--text-1)]">
                      {thread.client.name ?? thread.client.phone ?? t.inbox.unknown}
                    </p>
                    <p className="text-xs text-[var(--text-4)]">
                      {t.channel[thread.channel.provider as keyof typeof t.channel] ?? thread.channel.provider} · {thread.language}
                    </p>
                  </div>
                </div>
                <Badge variant={STAGE_VARIANT[thread.stage] ?? "neutral"}>{t.stage[thread.stage as keyof typeof t.stage] ?? thread.stage.replace(/_/g, " ")}</Badge>
              </div>

              <div className="space-y-3">
                {thread.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn("flex flex-col gap-1", m.sender === "CUSTOMER" ? "items-start" : "items-end")}
                    dir={m.language === "AR" ? "rtl" : "ltr"}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                        m.sender === "CUSTOMER"
                          ? "bg-[var(--surface-2)] text-[var(--text-1)]"
                          : "bg-accent-gradient text-white"
                      )}
                    >
                      {m.body}
                    </div>
                    <div className="flex items-center gap-1.5 px-1 text-[10px] text-[var(--text-5)]" dir="ltr">
                      <span>{m.sender === "CUSTOMER" ? t.inbox.customer : m.sender === "AI" ? t.inbox.ai : t.inbox.staff}</span>
                      <span>·</span>
                      <span>{timeAgo(m.createdAt)}</span>
                      {m.status === "PENDING_APPROVAL" && <Badge variant="warm">{t.inbox.pendingApproval}</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <SimulateMessageModal open={simulateOpen} onOpenChange={setSimulateOpen} lang={lang} />
    </div>
  );
}

function SimulateMessageModal({ open, onOpenChange, lang }: { open: boolean; onOpenChange: (v: boolean) => void; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const router = useRouter();
  const [form, setForm] = useState({ provider: "WHATSAPP", customerName: "", customerPhone: "", body: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = () => {
    if (!form.customerName.trim() || !form.body.trim()) {
      setError(t.inbox.requiredNameAndMessage);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await simulateInboundMessageAction({
        provider: form.provider as "WHATSAPP" | "INSTAGRAM" | "FACEBOOK",
        customerName: form.customerName,
        customerPhone: form.customerPhone || undefined,
        body: form.body,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to simulate message.");
        return;
      }
      setForm({ provider: "WHATSAPP", customerName: "", customerPhone: "", body: "" });
      onOpenChange(false);
      router.push(`/agency/inbox?conversation=${result.conversationId}`);
      router.refresh();
    });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t.inbox.modalTitle}
      description={t.inbox.modalDescription}
    >
      <div className="space-y-3">
        <Select
          value={form.provider}
          onValueChange={(v) => setForm((f) => ({ ...f, provider: v }))}
          options={[
            { value: "WHATSAPP", label: t.channel.WHATSAPP },
            { value: "INSTAGRAM", label: t.channel.INSTAGRAM },
            { value: "FACEBOOK", label: t.channel.FACEBOOK },
          ]}
        />
        <Input
          placeholder={t.inbox.customerName}
          value={form.customerName}
          onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
        />
        <Input
          placeholder={t.inbox.customerPhone}
          value={form.customerPhone}
          onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
        />
        <textarea
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          placeholder={t.inbox.messagePlaceholder}
          rows={3}
          dir="auto"
          className="flex w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-5)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
        />
        {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
        <Button className="w-full" disabled={pending} onClick={handleSubmit}>
          {pending ? t.inbox.sending : t.inbox.send}
        </Button>
      </div>
    </Modal>
  );
}
