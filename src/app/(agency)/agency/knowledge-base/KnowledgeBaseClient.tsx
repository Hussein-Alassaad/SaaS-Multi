"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { timeAgo } from "@/lib/utils";
import {
  createKnowledgeEntryAction,
  updateKnowledgeEntryAction,
  deleteKnowledgeEntryAction,
} from "@/lib/actions/agency-knowledge";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { Plus, Pencil, Trash2, BookOpen } from "lucide-react";

interface KnowledgeEntryRow {
  id: string;
  title: string;
  category: string;
  body: string;
  addedByName: string | null;
  updatedAt: string;
}

const CATEGORIES = ["SERVICES", "PRICING", "FAQ", "POLICY", "OTHER"];
const CATEGORY_VARIANT: Record<string, "accent" | "warm" | "neutral" | "outline"> = {
  SERVICES: "accent",
  PRICING: "warm",
  FAQ: "neutral",
  POLICY: "outline",
  OTHER: "outline",
};

export function KnowledgeBaseClient({ entries, lang }: { entries: KnowledgeEntryRow[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeEntryRow | null>(null);
  const [form, setForm] = useState({ title: "", category: "SERVICES", body: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openCreate = () => {
    setEditing(null);
    setForm({ title: "", category: "SERVICES", body: "" });
    setModalOpen(true);
  };

  const openEdit = (entry: KnowledgeEntryRow) => {
    setEditing(entry);
    setForm({ title: entry.title, category: entry.category, body: entry.body });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.title.trim() || !form.body.trim()) {
      setError(t.knowledgeBase.requiredTitleAndBody);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateKnowledgeEntryAction(editing.id, form)
        : await createKnowledgeEntryAction(form);
      if (!result.ok) {
        setError(result.error ?? "Failed to save.");
        return;
      }
      setModalOpen(false);
      router.refresh();
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      await deleteKnowledgeEntryAction(id);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.knowledgeBase.title}</h1>
          <p className="text-sm text-[var(--text-4)] mt-1">
            {t.knowledgeBase.subtitle}
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          {t.knowledgeBase.addEntry}
        </Button>
      </div>

      {entries.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="mb-3 h-8 w-8 text-[var(--text-5)]" />
          <p className="text-sm text-[var(--text-4)]">{t.knowledgeBase.empty}</p>
          <p className="mt-1 text-xs text-[var(--text-5)]">{t.knowledgeBase.emptyHint}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {entries.map((entry) => (
            <Card key={entry.id} padding="md">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--text-1)]">{entry.title}</p>
                    <Badge variant={CATEGORY_VARIANT[entry.category] ?? "neutral"}>{entry.category}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-5)]">
                    {entry.addedByName ?? "—"} · {t.knowledgeBase.updated} {timeAgo(entry.updatedAt)}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(entry)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(entry.id)} disabled={pending}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-sm text-[var(--text-3)] whitespace-pre-line line-clamp-4" dir="auto">
                {entry.body}
              </p>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? t.knowledgeBase.editEntry : t.knowledgeBase.addEntry}>
        <div className="space-y-3">
          <Input
            placeholder={t.knowledgeBase.titlePlaceholder}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <Select
            value={form.category}
            onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
          <textarea
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder={t.knowledgeBase.bodyPlaceholder}
            rows={6}
            dir="auto"
            className="flex w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-5)] outline-none"
          />
          {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
          <Button className="w-full" disabled={pending} onClick={handleSave}>
            {pending ? t.knowledgeBase.saving : editing ? t.knowledgeBase.saveChanges : t.knowledgeBase.addEntry}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
