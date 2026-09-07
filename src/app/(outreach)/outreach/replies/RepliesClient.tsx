"use client";

import { useState, useTransition, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessagesSquare, Send, ExternalLink, AlertTriangle, Paperclip, Mic, Square, X, FileText } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useOutreachRealtime } from "@/lib/outreach/realtime";
import { getReplyThreadsAction, sendReplyAction, type ReplyThreadLead } from "@/lib/actions/outreach-replies";

const TEMPERATURE_VARIANT: Record<string, "hot" | "warm" | "cold"> = { hot: "hot", warm: "warm", cold: "cold" };

const SEND_STATUS_LABEL: Record<string, { label: string; variant: "neutral" | "success" | "hot" }> = {
  pending: { label: "Pending — not sent yet", variant: "neutral" },
  sent: { label: "Sent", variant: "success" },
  failed: { label: "Failed to send", variant: "hot" },
};

function EmptyState({ tab }: { tab: "replied" | "notReplied" }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-16 flex flex-col items-center px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-gradient/15 ring-1 ring-[var(--accent-from)]/20">
        <MessagesSquare className="h-6 w-6 text-[var(--accent-from)]" strokeWidth={1.5} />
      </div>
      <p className="mt-4 text-sm font-medium text-[var(--text-2)]">
        {tab === "replied" ? "No replies yet" : "Nothing messaged and awaiting reply"}
      </p>
      <p className="mt-1 max-w-xs text-xs text-[var(--text-5)]">
        {tab === "replied"
          ? "Once a lead replies, their conversation shows up here."
          : "Leads you've messaged that haven't replied yet will appear here."}
      </p>
    </motion.div>
  );
}

function LeadListItem({
  thread,
  active,
  onClick,
}: {
  thread: ReplyThreadLead;
  active: boolean;
  onClick: () => void;
}) {
  const last = thread.messages[thread.messages.length - 1];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-[var(--accent-from)]/40 bg-accent-gradient/10"
          : "border-transparent hover:bg-[var(--surface-2)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-[var(--text-1)]">{thread.businessName || "Unnamed business"}</p>
        {thread.temperature && (
          <Badge variant={TEMPERATURE_VARIANT[thread.temperature] ?? "neutral"} dot className="shrink-0 capitalize">
            {thread.temperature}
          </Badge>
        )}
      </div>
      <p className="truncate text-xs text-[var(--text-5)] capitalize">
        {thread.platform}
        {last ? ` · ${last.from === "lead" ? "them" : "you"}: ${last.body.slice(0, 40)}` : ""}
      </p>
    </button>
  );
}

function Thread({ thread, onSent }: { thread: ReplyThreadLead; onSent: () => void }) {
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [attachment, setAttachment] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const { showToast } = useToast();

  const send = () => {
    const body = draft.trim();
    if (!body && !attachment) return;
    startTransition(async () => {
      const result = await sendReplyAction(thread.id, body, attachment);
      if (!result.ok) {
        showToast({ title: "Couldn't send", description: result.error, variant: "error" });
        return;
      }
      setDraft("");
      setAttachment(null);
      showToast({ title: "Reply queued", description: "The agent will deliver it shortly.", variant: "success" });
      onSent();
    });
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        setAttachment(new File([blob], `voice-note-${Date.now()}.webm`, { type: "audio/webm" }));
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      showToast({ title: "Couldn't access microphone", variant: "error" });
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text-1)]">{thread.businessName || "Unnamed business"}</p>
          <p className="text-xs text-[var(--text-5)] capitalize">{thread.platform} · {thread.status.replace("_", " ")}</p>
        </div>
        {thread.profileUrl && (
          <a
            href={thread.profileUrl}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-xs text-[var(--text-4)] hover:text-[var(--text-2)]"
          >
            Open profile <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {thread.messages.length === 0 && (
          <p className="text-center text-xs text-[var(--text-5)]">No messages yet.</p>
        )}
        {thread.messages.map((m) => {
          const statusMeta = m.sendStatus ? SEND_STATUS_LABEL[m.sendStatus] : null;
          return (
            <div key={m.id} className={`flex ${m.from === "us" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
                  m.from === "us"
                    ? "bg-accent-gradient text-white"
                    : "bg-[var(--surface-2)] text-[var(--text-1)]"
                }`}
              >
                {m.attachmentUrl && m.attachmentKind === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.attachmentUrl} alt={m.attachmentName ?? "Attachment"} className="mb-1.5 max-h-64 rounded-lg" />
                )}
                {m.attachmentUrl && m.attachmentKind === "video" && (
                  <video src={m.attachmentUrl} controls className="mb-1.5 max-h-64 rounded-lg" />
                )}
                {m.attachmentUrl && m.attachmentKind === "audio" && (
                  <audio src={m.attachmentUrl} controls className="mb-1.5 w-full" />
                )}
                {m.attachmentUrl && m.attachmentKind === "file" && (
                  <a
                    href={m.attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-black/10 px-2.5 py-1.5 text-xs underline"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" /> {m.attachmentName ?? "Attachment"}
                  </a>
                )}
                {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                <div className={`mt-1 flex items-center gap-1.5 text-[10px] ${m.from === "us" ? "text-white/70" : "text-[var(--text-5)]"}`}>
                  <span>{new Date(m.createdAt).toLocaleString()}</span>
                  {statusMeta && (
                    <Badge variant={statusMeta.variant} className="px-1.5 py-0.5 text-[9px]">
                      {statusMeta.label}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[var(--border-hairline)] p-3">
        {attachment && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-3)]">
            <span className="truncate">{attachment.name}</span>
            <button type="button" onClick={() => setAttachment(null)} className="shrink-0 text-[var(--text-5)] hover:text-[var(--text-1)]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setAttachment(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending || recording}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-hairline-strong)] text-[var(--text-3)] transition-colors hover:bg-[var(--surface-2)] disabled:opacity-40"
            title="Attach a photo, video, or file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={pending}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-40 ${
              recording
                ? "border-[var(--status-hot)]/40 bg-[var(--status-hot)]/10 text-[var(--status-hot)]"
                : "border-[var(--border-hairline-strong)] text-[var(--text-3)] hover:bg-[var(--surface-2)]"
            }`}
            title={recording ? "Stop recording" : "Record a voice note"}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Type your reply — the agent sends it from here, you never need to open the app."
            className="min-w-0 flex-1 resize-none rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 p-3 text-sm text-[var(--text-2)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
          />
          <motion.button
            whileTap={{ scale: 0.96 }}
            disabled={pending || (!draft.trim() && !attachment)}
            onClick={send}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-gradient text-white disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}

export function RepliesClient({
  tenantId,
  initialReplied,
  initialNotReplied,
}: {
  tenantId: string;
  initialReplied: ReplyThreadLead[];
  initialNotReplied: ReplyThreadLead[];
}) {
  const [replied, setReplied] = useState(initialReplied);
  const [notReplied, setNotReplied] = useState(initialNotReplied);
  const [tab, setTab] = useState<"replied" | "notReplied">(initialReplied.length > 0 ? "replied" : "notReplied");
  const [activeId, setActiveId] = useState<string | null>(initialReplied[0]?.id ?? initialNotReplied[0]?.id ?? null);

  const reload = useCallback(() => {
    getReplyThreadsAction().then((result) => {
      if (!result.ok) return;
      setReplied(result.replied);
      setNotReplied(result.notReplied);
    });
  }, []);

  useOutreachRealtime({ table: "outreach_replies", tenantId, reload });
  useOutreachRealtime({ table: "outreach_messages", tenantId, reload });
  useOutreachRealtime({ table: "outreach_leads", tenantId, reload });

  const list = tab === "replied" ? replied : notReplied;
  const active = useMemo(() => list.find((t) => t.id === activeId) ?? list[0] ?? null, [list, activeId]);

  return (
    <div className="mx-auto max-w-5xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Reply Here</h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">
          Read and respond to real conversations without opening LinkedIn or Instagram yourself — the agent delivers
          it for you.
        </p>
      </motion.header>

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--surface-1)]/50 p-1">
        <button
          type="button"
          onClick={() => setTab("replied")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            tab === "replied" ? "bg-[var(--surface-2)] text-[var(--text-1)]" : "text-[var(--text-4)]"
          }`}
        >
          Replied ({replied.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("notReplied")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            tab === "notReplied" ? "bg-[var(--surface-2)] text-[var(--text-1)]" : "text-[var(--text-4)]"
          }`}
        >
          Not replied yet ({notReplied.length})
        </button>
      </div>

      {tab === "notReplied" && notReplied.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--status-warm)]/30 bg-[var(--status-warm)]/10 p-3 text-xs text-[var(--status-warm)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            If you know one of these leads actually replied on LinkedIn/Instagram but it isn&apos;t showing here, the
            agent&apos;s detection may have missed it — check the real inbox for these accounts occasionally to be sure.
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[280px_1fr]">
        <div className="glass max-h-[70vh] space-y-1 overflow-y-auto rounded-2xl p-2">
          {list.length === 0 && <EmptyState tab={tab} />}
          {list.map((thread) => (
            <LeadListItem key={thread.id} thread={thread} active={thread.id === active?.id} onClick={() => setActiveId(thread.id)} />
          ))}
        </div>

        <div className="glass min-h-[70vh] overflow-hidden rounded-2xl">
          <AnimatePresence mode="wait">
            {active ? (
              <motion.div key={active.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                <Thread thread={active} onSent={reload} />
              </motion.div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-5)]">
                Select a conversation
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
