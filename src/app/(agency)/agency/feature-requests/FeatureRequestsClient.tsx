"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";
import { submitFeatureRequestAction } from "@/lib/actions/agency-feature-requests";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { Plus, MessageSquarePlus } from "lucide-react";

interface FeatureRequestRow {
  id: string;
  title: string;
  description: string;
  status: string;
  filedByName: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, "neutral" | "warm" | "accent" | "success" | "hot"> = {
  NEW: "neutral",
  UNDER_REVIEW: "warm",
  PLANNED: "accent",
  COMPLETED: "success",
  REJECTED: "hot",
};

export function FeatureRequestsClient({ requests, lang }: { requests: FeatureRequestRow[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const SUGGESTED_FEATURES = t.featureRequests.suggestions;
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openWithSuggestion = (suggestion: { title: string; description: string }) => {
    setForm(suggestion);
    setModalOpen(true);
  };

  const handleSubmit = () => {
    if (!form.title.trim() || !form.description.trim()) {
      setError(t.featureRequests.requiredTitleAndDescription);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await submitFeatureRequestAction(form);
      if (!result.ok) {
        setError(result.error ?? "Failed to submit.");
        return;
      }
      setForm({ title: "", description: "" });
      setModalOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.featureRequests.title}</h1>
          <p className="text-sm text-[var(--text-4)] mt-1">{t.featureRequests.subtitle}</p>
        </div>
        <Button size="sm" onClick={() => { setForm({ title: "", description: "" }); setModalOpen(true); }}>
          <Plus className="h-3.5 w-3.5" />
          {t.featureRequests.newRequest}
        </Button>
      </div>

      <Card padding="md">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--text-4)]">{t.featureRequests.popularRequests}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SUGGESTED_FEATURES.map((s) => (
            <button
              key={s.title}
              onClick={() => openWithSuggestion(s)}
              className="rounded-lg border border-[var(--border-hairline)] p-3 text-start transition-colors hover:bg-[var(--surface-2)]"
            >
              <p className="text-sm font-medium text-[var(--text-1)]">{s.title}</p>
              <p className="mt-0.5 text-xs text-[var(--text-4)]">{s.description}</p>
            </button>
          ))}
        </div>
      </Card>

      {requests.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-12 text-center">
          <MessageSquarePlus className="mb-3 h-8 w-8 text-[var(--text-5)]" />
          <p className="text-sm text-[var(--text-4)]">{t.featureRequests.empty}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <Card key={r.id} padding="sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--text-1)]">{r.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-4)]">{r.description}</p>
                  <p className="mt-1 text-[10px] text-[var(--text-5)]">{t.featureRequests.filed} {formatDate(r.createdAt)}</p>
                </div>
                <Badge variant={STATUS_VARIANT[r.status] ?? "neutral"}>{r.status.replace(/_/g, " ")}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={t.featureRequests.modalTitle}>
        <div className="space-y-3">
          <Input
            placeholder={t.featureRequests.titlePlaceholder}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder={t.featureRequests.descriptionPlaceholder}
            rows={4}
            className="flex w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-5)] outline-none"
          />
          {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
          <Button className="w-full" disabled={pending} onClick={handleSubmit}>
            {pending ? t.featureRequests.submitting : t.featureRequests.submitRequest}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
