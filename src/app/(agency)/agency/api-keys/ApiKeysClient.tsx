"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, KeyRound, Copy, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { timeAgo } from "@/lib/utils";
import { generateApiKeyAction, revokeApiKeyAction } from "@/lib/actions/marketing-api-keys";

interface ApiKeyRow {
  id: string;
  name: string;
  keyPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const router = useRouter();
  const [keys, setKeys] = useState(initialKeys);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await generateApiKeyAction(name.trim());
      if (result.ok) {
        setRevealedKey(result.rawKey);
        setName("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleRevoke(keyId: string) {
    startTransition(async () => {
      const result = await revokeApiKeyAction(keyId);
      if (result.ok) {
        setKeys((prev) => prev.filter((k) => k.id !== keyId));
        router.refresh();
      }
    });
  }

  async function copyKey() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">API Keys</h1>
          <p className="text-sm text-[var(--text-4)] mt-1">Generate keys for external integrations with your workspace.</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New key
        </Button>
      </div>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> Active keys
            </CardTitle>
            <CardDescription>The full key is shown only once, at creation.</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-2">
          {keys.length === 0 && <p className="py-4 text-center text-sm text-[var(--text-5)]">No API keys yet.</p>}
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between border-b border-[var(--border-hairline)] py-2.5 last:border-0">
              <div>
                <div className="text-sm text-[var(--text-1)]">{k.name}</div>
                <div className="font-mono text-xs text-[var(--text-5)]">{k.keyPreview}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-xs text-[var(--text-4)]">
                  <div>{k.lastUsedAt ? `Used ${timeAgo(k.lastUsedAt)}` : "Never used"}</div>
                  <div>Created {timeAgo(k.createdAt)}</div>
                </div>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleRevoke(k.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={modalOpen}
        onOpenChange={(v) => {
          setModalOpen(v);
          if (!v) {
            setRevealedKey(null);
            setName("");
            setError(null);
          }
        }}
        title={revealedKey ? "API key created" : "New API key"}
        description={
          revealedKey ? "Copy this key now -- it won't be shown again." : "Give this key a name so you can identify it later."
        }
      >
        {revealedKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2">
              <code className="flex-1 overflow-x-auto text-xs text-[var(--text-1)]">{revealedKey}</code>
              <Button variant="ghost" size="sm" onClick={copyKey}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <Button className="w-full" onClick={() => setModalOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input placeholder="e.g. CRM integration" value={name} onChange={(e) => setName(e.target.value)} />
            {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
            <Button className="w-full" disabled={pending || !name.trim()} onClick={handleCreate}>
              {pending ? "Creating..." : "Create key"}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
