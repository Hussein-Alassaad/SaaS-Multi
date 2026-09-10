"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, KeyRound, Copy, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { timeAgo } from "@/lib/utils";
import { revokeTenantSessionAction, addTenantIpAllowlistEntryAction, removeTenantIpAllowlistEntryAction } from "@/lib/actions/agency-security";
import { generateApiKeyAction, revokeApiKeyAction } from "@/lib/actions/marketing-api-keys";

interface SessionRow {
  id: string;
  userName: string;
  userEmail: string;
  device: string;
  ip: string;
  lastActiveAt: string;
}

interface ApiKeyRow {
  id: string;
  name: string;
  keyPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface AllowlistEntry {
  id: string;
  cidr: string;
  label: string | null;
}

export function SecurityClient({
  initialSessions,
  initialApiKeys,
  initialAllowlist,
  currentSessionId,
}: {
  initialSessions: SessionRow[];
  initialApiKeys: ApiKeyRow[];
  initialAllowlist: AllowlistEntry[];
  currentSessionId: string | null;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [keys, setKeys] = useState(initialApiKeys);
  const [allowlist, setAllowlist] = useState(initialAllowlist);
  const [newIp, setNewIp] = useState("");
  const [ipError, setIpError] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyModalOpen, setNewKeyModalOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleRevokeSession(sessionId: string) {
    startTransition(async () => {
      const result = await revokeTenantSessionAction(sessionId);
      if (result.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        router.refresh();
      }
    });
  }

  function handleCreateKey() {
    if (!newKeyName.trim()) return;
    startTransition(async () => {
      const result = await generateApiKeyAction(newKeyName.trim());
      if (result.ok) {
        setRevealedKey(result.rawKey);
        setNewKeyName("");
        router.refresh();
      }
    });
  }

  function handleRevokeKey(keyId: string) {
    startTransition(async () => {
      const result = await revokeApiKeyAction(keyId);
      if (result.ok) {
        setKeys((prev) => prev.filter((k) => k.id !== keyId));
        router.refresh();
      }
    });
  }

  function handleAddIp() {
    if (!newIp.trim()) return;
    startTransition(async () => {
      const result = await addTenantIpAllowlistEntryAction(newIp.trim());
      if (!result.ok) {
        setIpError(result.error);
        return;
      }
      setIpError(null);
      setNewIp("");
      router.refresh();
      setAllowlist((prev) => [...prev, { id: crypto.randomUUID(), cidr: newIp.trim(), label: null }]);
    });
  }

  function handleRemoveIp(entryId: string) {
    startTransition(async () => {
      const result = await removeTenantIpAllowlistEntryAction(entryId);
      if (result.ok) {
        setAllowlist((prev) => prev.filter((e) => e.id !== entryId));
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Security</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">Sessions, API keys, and network access for your workspace.</p>
      </div>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Signed-in sessions across your team.</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-2">
          {sessions.length === 0 && <p className="py-4 text-center text-sm text-[var(--text-5)]">No active sessions.</p>}
          {sessions.map((s) => {
            const isCurrent = s.id === currentSessionId;
            return (
              <div key={s.id} className="flex items-center gap-3 border-b border-[var(--border-hairline)] py-2.5 last:border-0">
                <Avatar name={s.userName} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[var(--text-1)]">
                    {s.userName} {isCurrent && <Badge variant="accent" className="ml-1">This device</Badge>}
                  </div>
                  <div className="text-xs text-[var(--text-5)]">
                    {s.userEmail} · {s.device} · {s.ip} · Active {timeAgo(s.lastActiveAt)}
                  </div>
                </div>
                {!isCurrent && (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleRevokeSession(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Revoke
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> API Keys
            </CardTitle>
            <CardDescription>Same keys shown on the API Keys page.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setNewKeyModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            New key
          </Button>
        </CardHeader>
        <div className="space-y-2">
          {keys.length === 0 && <p className="py-4 text-center text-sm text-[var(--text-5)]">No API keys yet.</p>}
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between border-b border-[var(--border-hairline)] py-2.5 last:border-0">
              <div>
                <div className="text-sm text-[var(--text-1)]">{k.name}</div>
                <div className="font-mono text-xs text-[var(--text-5)]">{k.keyPreview}</div>
              </div>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleRevokeKey(k.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>IP Allowlist</CardTitle>
            <CardDescription>Restrict sign-in to trusted network ranges. Empty means unrestricted.</CardDescription>
          </div>
        </CardHeader>
        <div className="mb-3 space-y-2">
          {allowlist.length === 0 && <p className="py-2 text-sm text-[var(--text-5)]">No entries -- sign-in is unrestricted by IP.</p>}
          {allowlist.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between border-b border-[var(--border-hairline)] py-2 last:border-0">
              <span className="font-mono text-xs text-[var(--text-2)]">{entry.cidr}</span>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleRemoveIp(entry.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. 203.0.113.0/24"
            value={newIp}
            onChange={(e) => {
              setNewIp(e.target.value);
              setIpError(null);
            }}
          />
          <Button variant="outline" disabled={pending} onClick={handleAddIp}>
            Add
          </Button>
        </div>
        {ipError && <p className="mt-2 text-xs text-[var(--status-hot)]">{ipError}</p>}
      </Card>

      <Modal
        open={newKeyModalOpen}
        onOpenChange={(v) => {
          setNewKeyModalOpen(v);
          if (!v) {
            setRevealedKey(null);
            setNewKeyName("");
          }
        }}
        title={revealedKey ? "API key created" : "New API key"}
        description={revealedKey ? "Copy this key now -- it won't be shown again." : "Give this key a name so you can identify it later."}
      >
        {revealedKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2">
              <code className="flex-1 overflow-x-auto text-xs text-[var(--text-1)]">{revealedKey}</code>
              <Button variant="ghost" size="sm" onClick={copyKey}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <Button className="w-full" onClick={() => setNewKeyModalOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input placeholder="e.g. CRM integration" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
            <Button className="w-full" disabled={pending || !newKeyName.trim()} onClick={handleCreateKey}>
              {pending ? "Creating..." : "Create key"}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
