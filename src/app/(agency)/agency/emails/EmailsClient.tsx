"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, Mail } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime, timeAgo } from "@/lib/utils";
import {
  createEmailTemplateAction,
  updateEmailTemplateAction,
  deleteEmailTemplateAction,
} from "@/lib/actions/marketing-emails";

interface SentEmailRow {
  id: string;
  subjectPreview: string;
  recipient: string;
  channel: string;
  fromMailbox: string | null;
  sentAt: string;
}

interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  body: string;
  updatedAt: string;
}

const EMPTY_FORM = { name: "", subject: "", body: "" };

export function EmailsClient({
  initialEmails,
  initialTemplates,
}: {
  initialEmails: SentEmailRow[];
  initialTemplates: TemplateRow[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(template: TemplateRow) {
    setEditingId(template.id);
    setForm({ name: template.name, subject: template.subject, body: template.body });
    setError(null);
    setModalOpen(true);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = editingId
        ? await updateEmailTemplateAction(editingId, form)
        : await createEmailTemplateAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setModalOpen(false);
      router.refresh();
      if (editingId) {
        setTemplates((prev) => prev.map((t) => (t.id === editingId ? { ...t, ...form, updatedAt: new Date().toISOString() } : t)));
      } else {
        setTemplates((prev) => [
          { id: result.template.id, name: form.name, subject: form.subject, body: form.body, updatedAt: new Date().toISOString() },
          ...prev,
        ]);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteEmailTemplateAction(id);
      if (result.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Emails</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">Sent email history and reusable templates.</p>
      </div>

      <Tabs defaultValue="sent">
        <TabsList>
          <TabsTrigger value="sent">Sent</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="sent">
          <Card padding="md">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Sent emails
                </CardTitle>
                <CardDescription>
                  Outbound emails sent through your connected Gmail/Outlook channels.
                </CardDescription>
              </div>
            </CardHeader>
            <div className="space-y-2">
              {initialEmails.length === 0 && (
                <p className="py-6 text-center text-sm text-[var(--text-5)]">No emails sent yet.</p>
              )}
              {initialEmails.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--text-1)]">{e.subjectPreview}</p>
                    <p className="truncate text-xs text-[var(--text-5)]">
                      To {e.recipient}
                      {e.fromMailbox ? ` · from ${e.fromMailbox}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline">{e.channel}</Badge>
                    <span className="text-xs text-[var(--text-5)]">{formatDateTime(e.sentAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <Card padding="md">
            <CardHeader>
              <div>
                <CardTitle>Template library</CardTitle>
                <CardDescription>Reusable subject/body pairs for your team.</CardDescription>
              </div>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                New template
              </Button>
            </CardHeader>
            <div className="space-y-2">
              {templates.length === 0 && (
                <p className="py-6 text-center text-sm text-[var(--text-5)]">No templates yet.</p>
              )}
              {templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--text-1)]">{t.name}</p>
                    <p className="truncate text-xs text-[var(--text-5)]">{t.subject}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-[var(--text-5)]">Updated {timeAgo(t.updatedAt)}</span>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleDelete(t.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingId ? "Edit template" : "New template"}
      >
        <div className="space-y-3">
          <Input placeholder="Template name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input placeholder="Subject" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
          <textarea
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder="Email body..."
            rows={8}
            className="flex w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-5)] outline-none"
          />
          {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
          <Button className="w-full" disabled={pending} onClick={handleSave}>
            {pending ? "Saving..." : editingId ? "Save changes" : "Create template"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
