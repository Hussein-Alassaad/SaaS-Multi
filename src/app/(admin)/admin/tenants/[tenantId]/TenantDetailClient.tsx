"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { Avatar } from "@/components/ui/Avatar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import {
  TenantStatusBadge,
  TicketStatusBadge,
  InvoiceStatusBadge,
  PriorityBadge,
} from "@/components/ui/StatusBadge";
import { formatCents, formatDate, formatDateTime, timeAgo } from "@/lib/utils";
import { useImpersonation } from "@/lib/store/impersonation";
import { startImpersonationAction } from "@/lib/actions/impersonation";
import { setFeatureFlagEnabledAction, setTenantSectionEnabledAction } from "@/lib/actions/feature-flags";
import {
  resetTenantOwnerPasswordAction,
  deactivateTenantAction,
  reactivateTenantAction,
  setOutreachDailyLimitAction,
  setOutreachSenderAction,
  setOutreachTimezoneAction,
} from "@/lib/actions/admin-tenants";
import { ArrowLeft, UserCog, Key, Mail, Bell, Folder, UserX, UserCheck, type LucideIcon } from "lucide-react";

interface TenantUser {
  id: string;
  name: string;
  email: string;
  status: string;
  lastLoginAt: string | null;
}
interface TenantSubscription {
  id: string;
  status: string;
  billingCycle: string;
  trialEndsAt: string | null;
  gracePeriodEndsAt: string | null;
  currentPeriodEnd: string | null;
  plan: {
    name: string;
    monthlyPrice: number;
    yearlyPrice: number;
    maxUsers: number;
    storageLimitMb: number;
    aiCredits: number;
    features: string[];
  };
}
interface TenantInvoice {
  id: string;
  number: string;
  status: string;
  amountCents: number;
  dueDate: string;
  issuedAt: string;
  paidAt: string | null;
}
interface TenantPayment {
  id: string;
  amountCents: number;
  status: string;
  method: string;
  processedAt: string;
  refunds: { id: string; amountCents: number; status: string }[];
}
interface TenantAiLog {
  id: string;
  model: string;
  tokens: number;
  costCents: number;
  responseTimeMs: number;
  success: boolean;
  createdAt: string;
}
interface TenantTicket {
  id: string;
  subject: string;
  type: string;
  priority: string;
  status: string;
  assigneeName: string | null;
  createdAt: string;
}
interface TenantAuditEntry {
  id: string;
  action: string;
  actorName: string;
  ip: string | null;
  device: string | null;
  browser: string | null;
  createdAt: string;
}
interface TenantImpersonation {
  id: string;
  adminName: string;
  reason: string | null;
  startedAt: string;
  endedAt: string | null;
}
interface TenantFlag {
  id: string;
  key: string;
  name: string;
  scope: string;
  enabled: boolean;
}
interface TenantSection {
  key: string;
  label: string;
  href: string;
  core?: boolean;
  enabled: boolean;
}
interface OutreachAccountRow {
  id: string;
  label: string;
  platform: string; // "linkedin" | "instagram" | "email"
  igDailyLimit: number;
  linkedinDailyLimit: number;
  emailDailyLimit: number;
  sesFromEmail: string | null;
  sesFromName: string | null;
  status: string;
}

interface TenantDetail {
  id: string;
  companyName: string;
  subdomain: string;
  status: string;
  storageUsedMb: number;
  aiCreditsUsed: number;
  createdAt: string;
  product: { id: string; name: string; slug: string };
  owner: { id: string; name: string; email: string } | null;
  users: TenantUser[];
  subscriptions: TenantSubscription[];
  invoices: TenantInvoice[];
  payments: TenantPayment[];
  aiUsageLogs: TenantAiLog[];
  supportTickets: TenantTicket[];
  auditLogs: TenantAuditEntry[];
  impersonationSessions: TenantImpersonation[];
  flags: TenantFlag[];
  sections: TenantSection[];
  outreachAccounts: OutreachAccountRow[];
  outreachTimezone: string | null;
}

interface Props {
  tenant: TenantDetail;
}

const TABS = [
  "General",
  "Subscription",
  "Storage",
  "AI",
  "Invoices",
  "Logs",
  "Sections",
  "Outreach Accounts",
  "Flags",
  "Files",
  "API Keys",
  "Emails",
  "Notifications",
  "Audit",
  "Support",
];

export function TenantDetailClient({ tenant }: Props) {
  const router = useRouter();
  const { startImpersonation } = useImpersonation();
  const [tab, setTab] = useState("General");
  const [flagState, setFlagState] = useState(
    Object.fromEntries(tenant.flags.map((f) => [f.id, f.enabled]))
  );
  const [pendingFlagId, setPendingFlagId] = useState<string | null>(null);
  const [, startFlagTransition] = useTransition();

  const handleFlagToggle = (flagId: string, next: boolean) => {
    const previous = flagState[flagId];
    setFlagState((s) => ({ ...s, [flagId]: next }));
    setPendingFlagId(flagId);
    startFlagTransition(async () => {
      const result = await setFeatureFlagEnabledAction(flagId, next);
      if (!result.ok) {
        setFlagState((s) => ({ ...s, [flagId]: previous }));
      }
      setPendingFlagId(null);
    });
  };

  const [sectionState, setSectionState] = useState(
    Object.fromEntries(tenant.sections.map((s) => [s.key, s.enabled]))
  );
  const [pendingSectionKey, setPendingSectionKey] = useState<string | null>(null);
  const [, startSectionTransition] = useTransition();

  const handleSectionToggle = (sectionKey: string, next: boolean) => {
    const previous = sectionState[sectionKey];
    setSectionState((s) => ({ ...s, [sectionKey]: next }));
    setPendingSectionKey(sectionKey);
    startSectionTransition(async () => {
      const result = await setTenantSectionEnabledAction(tenant.id, tenant.product.slug, sectionKey, next);
      if (!result.ok) {
        setSectionState((s) => ({ ...s, [sectionKey]: previous }));
      }
      setPendingSectionKey(null);
    });
  };

  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetPending, startResetTransition] = useTransition();

  const handleResetPassword = () => {
    setResetError(null);
    startResetTransition(async () => {
      const result = await resetTenantOwnerPasswordAction(tenant.id);
      if (!result.ok) {
        setResetError(result.error ?? "Failed to reset password.");
        return;
      }
      setResetResult({ email: result.email, password: result.password });
    });
  };

  const [status, setStatus] = useState(tenant.status);
  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [deactivatePending, startDeactivateTransition] = useTransition();

  const handleDeactivate = () => {
    setDeactivateError(null);
    startDeactivateTransition(async () => {
      const result = await deactivateTenantAction(tenant.id);
      if (!result.ok) {
        setDeactivateError(result.error ?? "Failed to deactivate tenant.");
        return;
      }
      setStatus("CHURNED");
      setDeactivateModalOpen(false);
    });
  };

  const handleReactivate = () => {
    setDeactivateError(null);
    startDeactivateTransition(async () => {
      const result = await reactivateTenantAction(tenant.id);
      if (!result.ok) {
        setDeactivateError(result.error ?? "Failed to reactivate tenant.");
        return;
      }
      setStatus("ACTIVE");
    });
  };

  const activeSub = tenant.subscriptions[0];
  const storagePct = activeSub
    ? Math.min(100, Math.round((tenant.storageUsedMb / activeSub.plan.storageLimitMb) * 100))
    : 0;
  const aiPct = activeSub
    ? Math.min(100, Math.round((tenant.aiCreditsUsed / activeSub.plan.aiCredits) * 100))
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/admin/tenants")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Avatar name={tenant.companyName} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-1)] truncate">
              {tenant.companyName}
            </h1>
            <TenantStatusBadge status={status} />
          </div>
          <p className="text-sm text-[var(--text-4)]">
            {tenant.subdomain}.example.com · {tenant.product.name} · Created {formatDate(tenant.createdAt)}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={async () => {
            const result = await startImpersonationAction(tenant.id);
            startImpersonation(tenant.id, tenant.companyName, result.ok ? result.sessionId : null);
          }}
        >
          <UserCog className="h-4 w-4" />
          Login as Tenant
        </Button>
        {status === "CHURNED" ? (
          <Button variant="outline" disabled={deactivatePending} onClick={handleReactivate}>
            <UserCheck className="h-4 w-4" />
            Reactivate
          </Button>
        ) : (
          <Button variant="destructive" onClick={() => setDeactivateModalOpen(true)}>
            <UserX className="h-4 w-4" />
            Remove tenant
          </Button>
        )}
      </div>
      {deactivateError && <p className="text-xs text-[var(--status-hot)]">{deactivateError}</p>}

      <Modal
        open={deactivateModalOpen}
        onOpenChange={setDeactivateModalOpen}
        title="Remove this tenant?"
        description={`${tenant.companyName} will be marked CHURNED -- their team loses login access immediately and every active session is revoked. All their data (leads, messages, billing history) stays intact and this can be reversed anytime with "Reactivate".`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeactivateModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deactivatePending} onClick={handleDeactivate}>
            {deactivatePending ? "Removing..." : "Remove tenant"}
          </Button>
        </div>
      </Modal>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="scroll-x-container">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="General">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Company Details</CardTitle>
              </CardHeader>
              <dl className="space-y-2 text-sm">
                <Row label="Company" value={tenant.companyName} />
                <Row label="Subdomain" value={`${tenant.subdomain}.example.com`} />
                <Row label="Product" value={tenant.product.name} />
                <Row label="Status" value={<TenantStatusBadge status={status} />} />
                <Row
                  label="Owner"
                  value={
                    tenant.owner ? (
                      <div className="flex items-center justify-between gap-2">
                        <span>{`${tenant.owner.name} (${tenant.owner.email})`}</span>
                        <Button size="sm" variant="outline" disabled={resetPending} onClick={handleResetPassword}>
                          <Key className="h-3.5 w-3.5" />
                          Reset password
                        </Button>
                      </div>
                    ) : (
                      "—"
                    )
                  }
                />
                {resetError && <p className="text-xs text-[var(--status-hot)]">{resetError}</p>}
                <Row label="Created" value={formatDateTime(tenant.createdAt)} />
              </dl>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Team Members ({tenant.users.length})</CardTitle>
              </CardHeader>
              <div className="space-y-3">
                {tenant.users.map((u) => (
                  <div key={u.id} className="flex items-center gap-2.5">
                    <Avatar name={u.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--text-1)] truncate">{u.name}</div>
                      <div className="text-xs text-[var(--text-5)] truncate">{u.email}</div>
                    </div>
                    <Badge variant="outline">{u.status}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="Subscription">
          {activeSub ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{activeSub.plan.name} Plan</CardTitle>
                  <CardDescription>
                    {formatCents(activeSub.billingCycle === "yearly" ? activeSub.plan.yearlyPrice : activeSub.plan.monthlyPrice)}
                    /{activeSub.billingCycle === "yearly" ? "yr" : "mo"}
                  </CardDescription>
                </div>
                <Badge variant={activeSub.status === "ACTIVE" ? "success" : "warm"}>{activeSub.status}</Badge>
              </CardHeader>
              <div className="grid grid-cols-2 gap-4 text-sm mb-4 md:grid-cols-4">
                <Stat label="Max Users" value={activeSub.plan.maxUsers.toString()} />
                <Stat label="Storage Limit" value={`${(activeSub.plan.storageLimitMb / 1024).toFixed(0)} GB`} />
                <Stat label="AI Credits" value={activeSub.plan.aiCredits.toLocaleString()} />
                <Stat
                  label="Period Ends"
                  value={activeSub.currentPeriodEnd ? formatDate(activeSub.currentPeriodEnd) : "—"}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {activeSub.plan.features.map((f: string) => (
                  <Badge key={f} variant="outline">
                    {f}
                  </Badge>
                ))}
              </div>
            </Card>
          ) : (
            <EmptyState label="No subscription found." />
          )}
        </TabsContent>

        <TabsContent value="Storage">
          <Card>
            <CardHeader>
              <CardTitle>Storage Usage</CardTitle>
              <CardDescription>
                {(tenant.storageUsedMb / 1024).toFixed(1)} GB used
                {activeSub && ` of ${(activeSub.plan.storageLimitMb / 1024).toFixed(0)} GB`}
              </CardDescription>
            </CardHeader>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${storagePct}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="h-full bg-accent-gradient"
              />
            </div>
            <p className="mt-2 text-xs text-[var(--text-4)]">{storagePct}% of allotted storage used</p>
          </Card>
        </TabsContent>

        <TabsContent value="AI">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>AI Credits</CardTitle>
                <CardDescription>
                  {tenant.aiCreditsUsed.toLocaleString()} used
                  {activeSub && ` of ${activeSub.plan.aiCredits.toLocaleString()}`}
                </CardDescription>
              </CardHeader>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${aiPct}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="h-full bg-accent-gradient"
                />
              </div>
            </Card>
            <AiLogsTable logs={tenant.aiUsageLogs} />
          </div>
        </TabsContent>

        <TabsContent value="Invoices">
          <InvoicesTable invoices={tenant.invoices} payments={tenant.payments} />
        </TabsContent>

        <TabsContent value="Logs">
          <AuditTable logs={tenant.auditLogs} title="Activity Logs" />
        </TabsContent>

        <TabsContent value="Sections">
          <Card>
            <CardHeader>
              <CardTitle>Sections</CardTitle>
              <CardDescription>
                Control which {tenant.product.name} sections this workspace can see. Core sections are always on.
              </CardDescription>
            </CardHeader>
            <div className="space-y-3">
              {tenant.sections.map((s) => (
                <Toggle
                  key={s.key}
                  checked={sectionState[s.key]}
                  onCheckedChange={(v) => handleSectionToggle(s.key, v)}
                  disabled={s.core || pendingSectionKey === s.key}
                  label={s.label}
                  description={s.core ? "Always on" : s.href}
                />
              ))}
              {tenant.sections.length === 0 && (
                <EmptyState label="No configurable sections for this product yet." />
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="Outreach Accounts">
          {tenant.outreachAccounts.length > 0 && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Scheduling Timezone</CardTitle>
                <CardDescription>
                  Every account&apos;s run time below is interpreted in this timezone -- Admin-only.
                  Tenants see this as read-only on their own Outreach Settings page.
                </CardDescription>
              </CardHeader>
              <OutreachTimezoneRow tenantId={tenant.id} timezone={tenant.outreachTimezone ?? "Asia/Beirut"} />
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Outreach Accounts</CardTitle>
              <CardDescription>
                Daily send/discovery caps -- Admin-only. Tenants see these as read-only on their own Account Health page.
              </CardDescription>
            </CardHeader>
            <div className="space-y-3">
              {tenant.outreachAccounts.map((a) => (
                <div key={a.id}>
                  <OutreachAccountLimitRow account={a} tenantId={tenant.id} />
                  {a.platform === "email" && <OutreachSenderRow account={a} tenantId={tenant.id} />}
                </div>
              ))}
              {tenant.outreachAccounts.length === 0 && (
                <EmptyState label="No Outreach accounts for this tenant yet." />
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="Flags">
          <Card>
            <CardHeader>
              <CardTitle>Feature Flags</CardTitle>
              <CardDescription>Global + tenant-scoped flags affecting this tenant</CardDescription>
            </CardHeader>
            <div className="space-y-3">
              {tenant.flags.map((f) => (
                <Toggle
                  key={f.id}
                  checked={flagState[f.id]}
                  onCheckedChange={(v) => handleFlagToggle(f.id, v)}
                  disabled={pendingFlagId === f.id}
                  label={f.name}
                  description={`${f.scope} scope · ${f.key}`}
                />
              ))}
              {tenant.flags.length === 0 && <EmptyState label="No flags configured for this tenant." />}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="Files">
          <EmptyPanel
            icon={Folder}
            title="File Storage"
            description="Tenant file browser will appear here once product-specific storage integrations are connected."
          />
        </TabsContent>

        <TabsContent value="API Keys">
          <EmptyPanel
            icon={Key}
            title="API Keys"
            description="Manage tenant-scoped API keys for programmatic access. No keys issued yet."
          />
        </TabsContent>

        <TabsContent value="Emails">
          <EmptyPanel
            icon={Mail}
            title="Email Activity"
            description="Transactional email delivery log for this tenant will appear here."
          />
        </TabsContent>

        <TabsContent value="Notifications">
          <EmptyPanel
            icon={Bell}
            title="Notifications"
            description="Broadcast and system notifications sent to this tenant will appear here."
          />
        </TabsContent>

        <TabsContent value="Audit">
          <AuditTable logs={tenant.auditLogs} title="Audit Trail" showImpersonations={tenant.impersonationSessions} />
        </TabsContent>

        <TabsContent value="Support">
          <SupportTable tickets={tenant.supportTickets} />
        </TabsContent>
      </Tabs>

      <Modal
        open={!!resetResult}
        onOpenChange={(open) => !open && setResetResult(null)}
        title="Password reset"
        description="Shown once -- copy it now and send it to the client. It cannot be viewed again after closing this."
      >
        {resetResult && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-5)]">Email</p>
              <p className="mt-1 text-sm text-[var(--text-1)]">{resetResult.email}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-5)]">New password</p>
              <p className="mt-1 rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-3 py-2 font-mono text-sm text-[var(--text-1)]">
                {resetResult.password}
              </p>
            </div>
            <Button className="w-full" onClick={() => setResetResult(null)}>
              Done
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-hairline)] py-1.5 last:border-0">
      <dt className="text-[var(--text-4)]">{label}</dt>
      <dd className="text-[var(--text-1)] font-medium">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--text-4)]">{label}</div>
      <div className="text-base font-semibold text-[var(--text-1)]">{value}</div>
    </div>
  );
}

/**
 * One editable daily-limit row per Outreach account -- only the field
 * relevant to that account's platform is shown/editable (an Instagram
 * account has no email limit, an email account has no LinkedIn limit).
 * Saves via setOutreachDailyLimitAction (Admin-only, see that action's own
 * docstring for why this moved out of the tenant-editable Account Health
 * page).
 */
function OutreachAccountLimitRow({ account, tenantId }: { account: OutreachAccountRow; tenantId: string }) {
  const field =
    account.platform === "email" ? "emailDailyLimit"
    : account.platform === "instagram" ? "igDailyLimit"
    : "linkedinDailyLimit";
  const [value, setValue] = useState(String(account[field]));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      setError("Enter a valid, non-negative number.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setOutreachDailyLimitAction(account.id, tenantId, field, num);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] py-2.5 last:border-0">
      <div>
        <p className="text-sm font-medium text-[var(--text-1)]">{account.label}</p>
        <p className="text-xs text-[var(--text-4)] capitalize">
          {account.platform} · {account.status}
        </p>
        {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
        />
        <Button size="sm" variant="outline" disabled={pending || value === String(account[field])} onClick={save}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The From email/name this email account sends cold outreach as (via
 * Resend -- see resend-email.ts). Admin-only, same posture as
 * OutreachAccountLimitRow above: the address lives under the platform's
 * own verified Resend domain (nxrs.tech), not the tenant's, so the tenant
 * sees it read-only on their own Account Health page but can't set it
 * themselves. See setOutreachSenderAction's own docstring.
 */
function OutreachSenderRow({ account, tenantId }: { account: OutreachAccountRow; tenantId: string }) {
  const [fromEmail, setFromEmail] = useState(account.sesFromEmail ?? "");
  const [fromName, setFromName] = useState(account.sesFromName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = fromEmail !== (account.sesFromEmail ?? "") || fromName !== (account.sesFromName ?? "");

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await setOutreachSenderAction(account.id, tenantId, fromEmail, fromName);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] py-2.5 pl-3 last:border-0">
      <div className="flex-1">
        <p className="text-xs text-[var(--text-4)]">From address (e.g. zimmar@nxrs.tech)</p>
        {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
        <div className="mt-1 flex gap-2">
          <input
            type="email"
            placeholder="sender@nxrs.tech"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            className="w-48 rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
          />
          <input
            type="text"
            placeholder="From name (optional)"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            className="w-40 rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
          />
        </div>
      </div>
      <Button size="sm" variant="outline" disabled={pending || !dirty} onClick={save}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

// Populated once, client-side, from the browser/Node's own IANA database
// (no npm dependency needed) -- module scope so it's computed once, not
// re-derived on every render.
const IANA_TIMEZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

/**
 * The IANA timezone every account's run_time (below, in Outreach Accounts)
 * is scheduled against for this tenant -- Admin-only, see
 * setOutreachTimezoneAction's own docstring for why this isn't
 * tenant-editable (a tenant targeting a foreign market, e.g. MJivity's
 * US/UK/Europe reach, needs this set correctly for their own "9:00 AM"
 * send time to mean anything relative to their actual audience).
 */
function OutreachTimezoneRow({ tenantId, timezone }: { tenantId: string; timezone: string }) {
  const [value, setValue] = useState(timezone);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await setOutreachTimezoneAction(tenantId, value);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
      </div>
      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
        >
          {!IANA_TIMEZONES.includes(value) && <option value={value}>{value}</option>}
          {IANA_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={pending || value === timezone} onClick={save}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-[var(--text-4)]">{label}</p>;
}

function EmptyPanel({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Card className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 rounded-full bg-[var(--surface-2)] p-3">
        <Icon className="h-5 w-5 text-[var(--text-4)]" />
      </div>
      <h3 className="text-sm font-medium text-[var(--text-1)]">{title}</h3>
      <p className="mt-1 max-w-sm text-xs text-[var(--text-4)]">{description}</p>
    </Card>
  );
}

function AiLogsTable({ logs }: { logs: TenantAiLog[] }) {
  const columns: Column<TenantAiLog>[] = [
    { key: "model", header: "Model", render: (l) => <Badge variant="outline">{l.model}</Badge> },
    { key: "tokens", header: "Tokens", render: (l) => l.tokens.toLocaleString() },
    { key: "cost", header: "Cost", render: (l) => formatCents(l.costCents) },
    { key: "latency", header: "Latency", render: (l) => `${l.responseTimeMs}ms` },
    {
      key: "status",
      header: "Status",
      render: (l) => <Badge variant={l.success ? "success" : "hot"}>{l.success ? "Success" : "Failed"}</Badge>,
    },
    { key: "when", header: "When", render: (l) => timeAgo(l.createdAt) },
  ];
  return <DataTable columns={columns} data={logs} rowKey={(l) => l.id} emptyMessage="No AI usage recorded." />;
}

function InvoicesTable({ invoices, payments }: { invoices: TenantInvoice[]; payments: TenantPayment[] }) {
  const columns: Column<TenantInvoice>[] = [
    { key: "number", header: "Invoice", render: (i) => <span className="font-mono text-xs">{i.number}</span> },
    { key: "amount", header: "Amount", render: (i) => formatCents(i.amountCents) },
    { key: "status", header: "Status", render: (i) => <InvoiceStatusBadge status={i.status} /> },
    { key: "issued", header: "Issued", render: (i) => formatDate(i.issuedAt) },
    { key: "due", header: "Due", render: (i) => formatDate(i.dueDate) },
  ];
  return (
    <div className="space-y-4">
      <DataTable columns={columns} data={invoices} rowKey={(i) => i.id} emptyMessage="No invoices yet." />
      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <div className="space-y-2">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm py-1.5 border-b border-[var(--border-hairline)] last:border-0">
              <span className="text-[var(--text-2)]">{formatDateTime(p.processedAt)} · {p.method}</span>
              <div className="flex items-center gap-2">
                {p.refunds.length > 0 && <Badge variant="warm">Refunded</Badge>}
                <span className="font-medium text-[var(--text-1)]">{formatCents(p.amountCents)}</span>
              </div>
            </div>
          ))}
          {payments.length === 0 && <EmptyState label="No payments recorded." />}
        </div>
      </Card>
    </div>
  );
}

function AuditTable({
  logs,
  title,
  showImpersonations,
}: {
  logs: TenantAuditEntry[];
  title: string;
  showImpersonations?: TenantImpersonation[];
}) {
  const columns: Column<TenantAuditEntry>[] = [
    { key: "action", header: "Action", render: (l) => l.action.replace(/_/g, " ").replace(/\./g, " ") },
    { key: "actor", header: "Actor", render: (l) => l.actorName },
    { key: "ip", header: "IP", render: (l) => <span className="font-mono text-xs">{l.ip}</span> },
    { key: "device", header: "Device", render: (l) => `${l.device} · ${l.browser}` },
    { key: "when", header: "When", render: (l) => timeAgo(l.createdAt) },
  ];
  return (
    <div className="space-y-4">
      <Card padding="none" className="p-4">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      </Card>
      <DataTable columns={columns} data={logs} rowKey={(l) => l.id} emptyMessage="No audit events." />
      {showImpersonations && (
        <Card>
          <CardHeader>
            <CardTitle>Impersonation Sessions</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {showImpersonations.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm py-1.5 border-b border-[var(--border-hairline)] last:border-0">
                <span className="text-[var(--text-2)]">
                  {s.adminName} · {s.reason ?? "No reason given"}
                </span>
                <span className="text-[var(--text-4)] text-xs">
                  {formatDateTime(s.startedAt)} {s.endedAt ? `→ ${formatDateTime(s.endedAt)}` : "(active)"}
                </span>
              </div>
            ))}
            {showImpersonations.length === 0 && <EmptyState label="No impersonation sessions." />}
          </div>
        </Card>
      )}
    </div>
  );
}

function SupportTable({ tickets }: { tickets: TenantTicket[] }) {
  const columns: Column<TenantTicket>[] = [
    { key: "subject", header: "Subject", render: (t) => t.subject },
    { key: "type", header: "Type", render: (t) => <Badge variant="outline">{t.type.replace(/_/g, " ")}</Badge> },
    { key: "priority", header: "Priority", render: (t) => <PriorityBadge priority={t.priority} /> },
    { key: "status", header: "Status", render: (t) => <TicketStatusBadge status={t.status} /> },
    { key: "assignee", header: "Assignee", render: (t) => t.assigneeName ?? "Unassigned" },
    { key: "created", header: "Created", render: (t) => timeAgo(t.createdAt) },
  ];
  return <DataTable columns={columns} data={tickets} rowKey={(t) => t.id} emptyMessage="No support tickets." />;
}
