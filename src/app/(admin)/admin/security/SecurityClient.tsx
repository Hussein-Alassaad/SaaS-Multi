"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Toggle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { timeAgo } from "@/lib/utils";
import { Plus, Trash2, KeyRound } from "lucide-react";

interface SessionRow {
  id: string;
  userName: string;
  device: string;
  ip: string;
  lastActiveAt: string;
  current: boolean;
}

interface ApiKeyRow {
  id: string;
  label: string;
  keyPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const SESSIONS: SessionRow[] = [
  { id: "1", userName: "Ava Whitfield", device: "Chrome on macOS", ip: "172.64.10.2", lastActiveAt: new Date().toISOString(), current: true },
  { id: "2", userName: "Leo Marchetti", device: "Safari on iOS", ip: "104.28.4.11", lastActiveAt: new Date(Date.now() - 3600_000 * 3).toISOString(), current: false },
  { id: "3", userName: "Nina Osei", device: "Edge on Windows", ip: "91.203.5.44", lastActiveAt: new Date(Date.now() - 3600_000 * 26).toISOString(), current: false },
];

const API_KEYS: ApiKeyRow[] = [
  { id: "1", label: "CI/CD Deploy Key", keyPreview: "sk_live_••••8f2a", createdAt: new Date(Date.now() - 86400_000 * 90).toISOString(), lastUsedAt: new Date(Date.now() - 3600_000).toISOString() },
  { id: "2", label: "Analytics Export", keyPreview: "sk_live_••••1c7d", createdAt: new Date(Date.now() - 86400_000 * 30).toISOString(), lastUsedAt: null },
];

const ALLOWLIST = ["203.0.113.0/24", "198.51.100.14", "192.0.2.55"];

export function SecurityClient() {
  const [mfaRequired, setMfaRequired] = useState(true);
  const [ssoEnforced, setSsoEnforced] = useState(false);
  const [allowlist, setAllowlist] = useState(ALLOWLIST);
  const [newIp, setNewIp] = useState("");

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
            onCheckedChange={setMfaRequired}
            label="Require MFA"
            description="All platform admins must enroll in multi-factor authentication"
          />
          <Toggle
            checked={ssoEnforced}
            onCheckedChange={setSsoEnforced}
            label="Enforce SSO"
            description="Require single sign-on via configured identity provider"
          />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Sessions</CardTitle>
          <CardDescription>Sessions currently signed into the admin platform</CardDescription>
        </CardHeader>
        <div className="space-y-2">
          {SESSIONS.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-b border-[var(--border-hairline)] py-2.5 last:border-0">
              <Avatar name={s.userName} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-[var(--text-1)]">
                  {s.userName} {s.current && <Badge variant="accent" className="ml-1">This device</Badge>}
                </div>
                <div className="text-xs text-[var(--text-5)]">
                  {s.device} · {s.ip} · Active {timeAgo(s.lastActiveAt)}
                </div>
              </div>
              {!s.current && (
                <Button variant="ghost" size="sm">
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </Button>
              )}
            </div>
          ))}
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
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" />
            New Key
          </Button>
        </CardHeader>
        <div className="space-y-2">
          {API_KEYS.map((k) => (
            <div key={k.id} className="flex items-center justify-between border-b border-[var(--border-hairline)] py-2.5 last:border-0">
              <div>
                <div className="text-sm text-[var(--text-1)]">{k.label}</div>
                <div className="font-mono text-xs text-[var(--text-5)]">{k.keyPreview}</div>
              </div>
              <div className="text-right text-xs text-[var(--text-4)]">
                <div>{k.lastUsedAt ? `Used ${timeAgo(k.lastUsedAt)}` : "Never used"}</div>
                <div>Created {timeAgo(k.createdAt)}</div>
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
          {allowlist.map((ip) => (
            <div key={ip} className="flex items-center justify-between border-b border-[var(--border-hairline)] py-2 last:border-0">
              <span className="font-mono text-xs text-[var(--text-2)]">{ip}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAllowlist((list) => list.filter((i) => i !== ip))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder="e.g. 203.0.113.0/24" value={newIp} onChange={(e) => setNewIp(e.target.value)} />
          <Button
            variant="outline"
            onClick={() => {
              if (newIp.trim()) {
                setAllowlist((list) => [...list, newIp.trim()]);
                setNewIp("");
              }
            }}
          >
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
