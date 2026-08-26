"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Toggle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { timeAgo } from "@/lib/utils";
import { Plus, Trash2, KeyRound, Copy, Check } from "lucide-react";
import {
  updateSecurityPolicyAction,
  revokeSessionAction,
  createApiKeyAction,
  revokeApiKeyAction,
  addIpAllowlistEntryAction,
  removeIpAllowlistEntryAction,
} from "@/lib/actions/security";

interface SessionRow {
  id: string;
  userName: string;
  userEmail: string;
  userScope: string;
  device: string;
  ip: string;
  lastActiveAt: string;
}

interface ApiKeyRow {
  id: string;
  label: string;
  keyPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface AllowlistEntry {
  id: string;
  cidr: string;
}

export function SecurityClient({
  initialPolicy,
  initialSessions,
  initialApiKeys,
  initialAllowlist,
  currentSessionId,
}: {
  initialPolicy: { mfaRequired: boolean; ssoEnforced: boolean };
  initialSessions: SessionRow[];
  initialApiKeys: ApiKeyRow[];
  initialAllowlist: AllowlistEntry[];
  currentSessionId: string | null;
}) {
  const router = useRouter();
  const [mfaRequired, setMfaRequired] = useState(initialPolicy.mfaRequired);
  const [ssoEnforced, setSsoEnforced] = useState(initialPolicy.ssoEnforced);
  const [newIp, setNewIp] = useState("");
  const [ipError, setIpError] = useState<string | null>(null);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeyModalOpen, setNewKeyModalOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function handlePolicyChange(field: "mfaRequired" | "ssoEnforced", value: boolean) {
    if (field === "mfaRequired") setMfaRequired(value);
    else setSsoEnforced(value);
    startTransition(async () => {
      await updateSecurityPolicyAction({
        mfaRequired: field === "mfaRequired" ? value : mfaRequired,
        ssoEnforced: field === "ssoEnforced" ? value : ssoEnforced,
      });
    });
  }

  function handleRevokeSession(sessionId: string) {
    startTransition(async () => {
      await revokeSessionAction(sessionId);
      router.refresh();
    });
  }

  function handleCreateKey() {
    if (!newKeyLabel.trim()) return;
    startTransition(async () => {
      const result = await createApiKeyAction(newKeyLabel.trim());
      if (result.ok) {
        setRevealedKey(result.rawKey);
        setNewKeyLabel("");
        router.refresh();
      }
    });
  }

  function handleRevokeKey(keyId: string) {
    startTransition(async () => {
      await revokeApiKeyAction(keyId);
      router.refresh();
    });
  }

  function handleAddIp() {
    if (!newIp.trim()) return;
    startTransition(async () => {
      const result = await addIpAllowlistEntryAction(newIp.trim());
      if (!result.ok) {
        setIpError(result.error ?? "Failed to add entry.");
        return;
      }
      setIpError(null);
      setNewIp("");
      router.refresh();
    });
  }

  function handleRemoveIp(entryId: string) {
    startTransition(async () => {
      await removeIpAllowlistEntryAction(entryId);
      router.refresh();
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
      <Card>
        <CardHeader>
          <CardTitle>Authentication Policy</CardTitle>
          <CardDescription>Platform-wide authentication requirements for internal admins</CardDescription>
        </CardHeader>
        <div className="space-y-4">
          <Toggle
            checked={mfaRequired}
            onCheckedChange={(v) => handlePolicyChange("mfaRequired", v)}
            label="Require MFA"
            description="All platform admins must enroll in multi-factor authentication"
          />
          <Toggle
            checked={ssoEnforced}
            onCheckedChange={(v) => handlePolicyChange("ssoEnforced", v)}
            label="Enforce SSO"
            description="Require single sign-on via configured identity provider"
          />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Sessions</CardTitle>
          <CardDescription>Real signed-in sessions, platform-wide across Admin and every tenant workspace</CardDescription>
        </CardHeader>
        <div className="space-y-2">
          {initialSessions.length === 0 && (
            <p className="py-4 text-center text-sm text-[var(--text-5)]">No active sessions.</p>
          )}
          {initialSessions.map((s) => {
            const isCurrent = s.id === currentSessionId;
            return (
              <div key={s.id} className="flex items-center gap-3 border-b border-[var(--border-hairline)] py-2.5 last:border-0">
                <Avatar name={s.userName} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[var(--text-1)]">
                    {s.userName}{" "}
                    <span className="text-[var(--text-5)]">({s.userScope === "PLATFORM" ? "Admin" : "Tenant"})</span>{" "}
                    {isCurrent && <Badge variant="accent" className="ml-1">This device</Badge>}
                  </div>
                  <div className="text-xs text-[var(--text-5)]">
                    {s.device} · {s.ip} · Active {timeAgo(s.lastActiveAt)}
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

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> API Keys
            </CardTitle>
            <CardDescription>Platform-level API keys for external integrations</CardDescription>
          </div>
          <Button size="sm" onClick={() => setNewKeyModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            New Key
          </Button>
        </CardHeader>
        <div className="space-y-2">
          {initialApiKeys.length === 0 && (
            <p className="py-4 text-center text-sm text-[var(--text-5)]">No API keys yet.</p>
          )}
          {initialApiKeys.map((k) => (
            <div key={k.id} className="flex items-center justify-between border-b border-[var(--border-hairline)] py-2.5 last:border-0">
              <div>
                <div className="text-sm text-[var(--text-1)]">{k.label}</div>
                <div className="font-mono text-xs text-[var(--text-5)]">{k.keyPreview}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-xs text-[var(--text-4)]">
                  <div>{k.lastUsedAt ? `Used ${timeAgo(k.lastUsedAt)}` : "Never used"}</div>
                  <div>Created {timeAgo(k.createdAt)}</div>
                </div>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleRevokeKey(k.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>IP Allowlist</CardTitle>
          <CardDescription>Restrict admin access to trusted network ranges</CardDescription>
        </CardHeader>
        <div className="space-y-2 mb-3">
          {initialAllowlist.length === 0 && (
            <p className="py-2 text-sm text-[var(--text-5)]">No entries -- access is unrestricted by IP.</p>
          )}
          {initialAllowlist.map((entry) => (
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
            setNewKeyLabel("");
          }
        }}
        title={revealedKey ? "API key created" : "New API Key"}
        description={
          revealedKey
            ? "Copy this key now -- it won't be shown again."
            : "Give this key a label so you can identify it later."
        }
      >
        {revealedKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] px-3 py-2">
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
            <Input placeholder="e.g. CI/CD Deploy Key" value={newKeyLabel} onChange={(e) => setNewKeyLabel(e.target.value)} />
            <Button className="w-full" disabled={pending || !newKeyLabel.trim()} onClick={handleCreateKey}>
              {pending ? "Creating..." : "Create key"}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
