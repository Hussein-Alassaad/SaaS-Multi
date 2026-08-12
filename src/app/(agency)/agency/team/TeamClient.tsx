"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Avatar } from "@/components/ui/Avatar";
import { formatDate, timeAgo } from "@/lib/utils";
import {
  inviteTeamMemberAction,
  revokeInviteAction,
  updateMemberRoleAction,
  removeMemberAction,
} from "@/lib/actions/agency-team";
import type { AgencyRole } from "@/lib/agency-permissions";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { Plus, X, UserMinus } from "lucide-react";

interface Member {
  id: string;
  name: string;
  email: string;
  status: string;
  roleName: string;
  lastLoginAt: string | null;
}
interface Invite {
  id: string;
  email: string;
  roleName: string;
  invitedByName: string | null;
  createdAt: string;
}

export function TeamClient({
  members,
  invites,
  roleOptions,
  currentUserId,
  lang,
}: {
  members: Member[];
  invites: Invite[];
  roleOptions: string[];
  currentUserId: string;
  lang: UiLanguage;
}) {
  const t = getDictionary(lang);
  const router = useRouter();
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: roleOptions[0] ?? "Freelancer" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleInvite = () => {
    if (!inviteForm.email.trim()) {
      setError(t.team.requiredEmail);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await inviteTeamMemberAction(inviteForm.email, inviteForm.role as AgencyRole);
      if (!result.ok) {
        setError(result.error ?? "Failed to send invite.");
        return;
      }
      setInviteModalOpen(false);
      setInviteForm({ email: "", role: roleOptions[0] ?? "Freelancer" });
      router.refresh();
    });
  };

  const handleRevoke = (inviteId: string) => {
    startTransition(async () => {
      await revokeInviteAction(inviteId);
      router.refresh();
    });
  };

  const handleRoleChange = (userId: string, role: string) => {
    startTransition(async () => {
      await updateMemberRoleAction(userId, role as AgencyRole);
      router.refresh();
    });
  };

  const handleRemove = (userId: string) => {
    startTransition(async () => {
      await removeMemberAction(userId);
      router.refresh();
    });
  };

  const memberColumns: Column<Member>[] = [
    {
      key: "name",
      header: t.team.colMember,
      render: (m) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={m.name} size="sm" />
          <div className="min-w-0">
            <div className="font-medium text-[var(--text-1)] truncate">{m.name}</div>
            <div className="text-xs text-[var(--text-5)] truncate">{m.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: t.team.colRole,
      render: (m) => (
        <Select
          value={m.roleName}
          onValueChange={(v) => handleRoleChange(m.id, v)}
          options={roleOptions.map((r) => ({ value: r, label: r }))}
          className="w-40"
        />
      ),
    },
    { key: "status", header: t.team.colStatus, render: (m) => <Badge variant="outline">{m.status}</Badge> },
    { key: "lastLogin", header: t.team.colLastLogin, render: (m) => <span className="text-[var(--text-4)]">{m.lastLoginAt ? timeAgo(m.lastLoginAt) : t.team.never}</span> },
    {
      key: "actions",
      header: "",
      render: (m) =>
        m.id === currentUserId ? null : (
          <Button size="sm" variant="ghost" onClick={() => handleRemove(m.id)} disabled={pending}>
            <UserMinus className="h-3.5 w-3.5" />
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-4)]">{members.length} {t.team.members}</span>
        <Button size="sm" onClick={() => setInviteModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {t.team.inviteMember}
        </Button>
      </div>

      <DataTable columns={memberColumns} data={members} rowKey={(m) => m.id} emptyMessage={t.team.emptyMessage} />

      {invites.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--text-4)]">
            {t.team.pendingInvites} ({invites.length})
          </h2>
          <div className="space-y-2">
            {invites.map((inv) => (
              <Card key={inv.id} padding="sm" className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--text-1)]">{inv.email}</p>
                  <p className="text-xs text-[var(--text-5)]">
                    {inv.roleName} · {t.team.invited} {formatDate(inv.createdAt)}
                    {inv.invitedByName && ` ${t.team.by} ${inv.invitedByName}`}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => handleRevoke(inv.id)} disabled={pending}>
                  <X className="h-3.5 w-3.5" />
                  {t.team.revoke}
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Modal open={inviteModalOpen} onOpenChange={setInviteModalOpen} title={t.team.modalTitle} description={t.team.modalDescription}>
        <div className="space-y-3">
          <Input placeholder={t.team.emailPlaceholder} value={inviteForm.email} onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))} />
          <Select
            value={inviteForm.role}
            onValueChange={(v) => setInviteForm((f) => ({ ...f, role: v }))}
            options={roleOptions.map((r) => ({ value: r, label: r }))}
          />
          {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
          <Button className="w-full" disabled={pending || !inviteForm.email.trim()} onClick={handleInvite}>
            {pending ? t.team.sending : t.team.sendInvite}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
