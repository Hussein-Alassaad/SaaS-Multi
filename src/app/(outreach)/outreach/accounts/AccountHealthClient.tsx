"use client";

import { useCallback, useState, useTransition } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useOutreachRealtime } from "@/lib/outreach/realtime";
import {
  saveAccountDraftAction,
  toggleRedistributeAction,
  resumeAccountAction,
  createOutreachAccountAction,
  deleteOutreachAccountAction,
  type AccountDraftInput,
} from "@/lib/actions/outreach-accounts";
import { disconnectAccountAction } from "@/lib/actions/outreach-live-login";
import { ConnectAccountModal } from "./ConnectAccountModal";
import { ImportSessionModal } from "./ImportSessionModal";

export interface AccountHealthRow {
  id: string;
  label: string;
  platform: string; // "instagram" | "linkedin" | "email"
  runTime: string; // "HH:MM:SS"
  igDailyLimit: number;
  linkedinDailyLimit: number;
  emailDailyLimit: number;
  igMonthlyLimit: number;
  linkedinMonthlyLimit: number;
  emailMonthlyLimit: number;
  sentToday: number;
  sentThisWeek: number;
  sentThisMonth: number;
  repliedThisWeek: number;
  proxyHost: string | null;
  proxyPort: string | null;
  proxyUsername: string | null;
  hasProxyPassword: boolean;
  verifiedProxyIp: string | null;
  loginEmail: string | null;
  hasLoginPassword: boolean;
  loginStatus: string; // "not_connected" | "pending_first_login" | "connecting" | "connected" | "failed"
  loginError: string | null;
  loginConnectedAt: string | null;
  loginConnectingAt: string | null;
  sesFromEmail: string | null;
  sesFromName: string | null;
  warmupCurrentLimit: number;
  status: string; // "active" | "warned" | "paused"
  warningType: string | null;
  warningReason: string | null;
  redistributeFlag: boolean;
}

interface AccountDraft {
  runTime: string; // "HH:MM" for <input type="time">
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string; // always starts empty -- never seeded from a decrypted value
}

const LOGIN_STATUS_STYLE: Record<string, string> = {
  connected: "bg-[#4fd293]/10 text-[#4fd293] ring-1 ring-[#4fd293]/30",
  pending_first_login: "bg-[var(--status-warm)]/10 text-[var(--status-warm)] ring-1 ring-[var(--status-warm)]/30",
  connecting: "bg-[var(--status-warm)]/10 text-[var(--status-warm)] ring-1 ring-[var(--status-warm)]/30",
  failed: "bg-[var(--status-hot)]/10 text-[var(--status-hot)] ring-1 ring-[var(--status-hot)]/30",
  not_connected: "bg-[var(--surface-2)] text-[var(--text-4)] ring-1 ring-[var(--border-hairline-strong)]",
};
const LOGIN_STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  pending_first_login: "Connecting…",
  connecting: "Connecting…",
  failed: "Login failed",
  not_connected: "Not connected",
};

// A "connecting" session whose droplet process crashed mid-way never gets a
// terminal status written -- treat anything older than this as stuck rather
// than showing a permanently-frozen badge with no way out.
const STALE_CONNECTING_MS = 15 * 60 * 1000;
function isStaleConnecting(account: AccountHealthRow): boolean {
  if (account.loginStatus !== "connecting") return false;
  if (!account.loginConnectingAt) return true;
  return Date.now() - new Date(account.loginConnectingAt).getTime() > STALE_CONNECTING_MS;
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-[#4fd293]/10 text-[#4fd293] ring-1 ring-[#4fd293]/30",
  warned: "bg-[var(--status-warm)]/10 text-[var(--status-warm)] ring-1 ring-[var(--status-warm)]/30",
  paused: "bg-[var(--status-hot)]/10 text-[var(--status-hot)] ring-1 ring-[var(--status-hot)]/30",
};
const STATUS_DOT: Record<string, string> = {
  active: "bg-[#4fd293]",
  warned: "bg-[var(--status-warm)]",
  paused: "bg-[var(--status-hot)]",
};

// The account's daily send cap for its own platform -- email/instagram/
// linkedin each store their limit in a different column (see
// OutreachAccount's ig/linkedin/emailDailyLimit fields), so this picks the
// one that actually applies to THIS account rather than showing a fixed set
// of boxes regardless of what's connected.
function dailyLimitFor(account: AccountHealthRow): number {
  if (account.platform === "email") return account.emailDailyLimit;
  if (account.platform === "instagram") return account.igDailyLimit;
  return account.linkedinDailyLimit;
}

function ReachProgress({ account }: { account: AccountHealthRow }) {
  const limit = dailyLimitFor(account);
  const pct = limit > 0 ? Math.min(100, Math.round((account.sentToday / limit) * 100)) : 0;
  const replyRate =
    account.sentThisWeek > 0 ? Math.round((account.repliedThisWeek / account.sentThisWeek) * 100) : null;
  return (
    <div className="mt-3 rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/40 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-2)]">
          {account.sentToday} of {limit} reached today
        </span>
        <span className="text-[var(--text-5)]">{account.sentThisWeek} this week</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className="h-full rounded-full bg-accent-gradient transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      {replyRate !== null && (
        <p className="mt-1.5 text-[11px] text-[var(--text-5)]">
          {replyRate}% reply rate this week ({account.repliedThisWeek} of {account.sentThisWeek})
        </p>
      )}
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-2.5 py-1.5 text-xs text-[var(--text-2)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]";
const labelClass = "text-[11px] font-medium uppercase tracking-wide text-[var(--text-5)]";

function draftFrom(account: AccountHealthRow): AccountDraft {
  return {
    runTime: (account.runTime || "").slice(0, 5), // "HH:MM:SS" -> "HH:MM" for <input type="time">
    proxyHost: account.proxyHost || "",
    proxyPort: account.proxyPort || "",
    proxyUsername: account.proxyUsername || "",
    proxyPassword: "",
  };
}

export function AccountHealthClient({
  tenantId,
  initialAccounts,
  enabledPlatforms,
}: {
  tenantId: string;
  initialAccounts: AccountHealthRow[];
  enabledPlatforms: { linkedin: boolean; email: boolean; instagram: boolean };
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  // Seeded once per account id -- a realtime reload must never stomp an
  // in-progress edit, same rule the original AccountHealth.jsx's load()
  // enforces via its `if (!next[account.id]) next[account.id] = draftFrom(account)` guard.
  const [drafts, setDrafts] = useState<Record<string, AccountDraft>>(() =>
    Object.fromEntries(initialAccounts.map((a) => [a.id, draftFrom(a)]))
  );
  const [, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  const reload = useCallback(() => router.refresh(), [router]);
  useOutreachRealtime({ table: "outreach_accounts", tenantId, reload });

  const [connectingAccount, setConnectingAccount] = useState<AccountHealthRow | null>(null);
  const openConnectModal = useCallback((account: AccountHealthRow) => setConnectingAccount(account), []);

  const [importingAccount, setImportingAccount] = useState<AccountHealthRow | null>(null);
  const openImportModal = useCallback((account: AccountHealthRow) => setImportingAccount(account), []);

  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const disconnectAccount = useCallback(
    (account: AccountHealthRow) => {
      if (!window.confirm(`Disconnect ${account.label}? This ends its saved login -- you'll need to connect it again before it can send.`)) {
        return;
      }
      setDisconnectingId(account.id);
      startTransition(async () => {
        const result = await disconnectAccountAction(account.id);
        setDisconnectingId(null);
        if (!result.ok) {
          showToast({ title: "Disconnect failed", description: result.error, variant: "error" });
          return;
        }
        showToast({ title: "Disconnected", description: `${account.label} has been disconnected.`, variant: "success" });
        router.refresh();
      });
    },
    [showToast, router]
  );

  // router.refresh() re-runs the server component and hands this component
  // fresh `initialAccounts` props -- sync that into `accounts` state on
  // every change, but only ever ADD/refresh drafts for accounts that don't
  // already have one (same seed-once rule as the original's load(): a
  // realtime-triggered reload must never stomp an in-progress edit).
  // Updated during render (not in an effect, and not via a ref -- this
  // repo's lint config forbids ref reads/writes during render) so the
  // fresh props land in the same commit instead of a stale frame.
  const [prevInitialAccounts, setPrevInitialAccounts] = useState(initialAccounts);
  if (prevInitialAccounts !== initialAccounts) {
    setPrevInitialAccounts(initialAccounts);
    setAccounts(initialAccounts);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const account of initialAccounts) {
        if (!next[account.id]) next[account.id] = draftFrom(account);
      }
      return next;
    });
  }

  function setDraftField<K extends keyof AccountDraft>(accountId: string, field: K, value: AccountDraft[K]) {
    setDrafts((d) => ({ ...d, [accountId]: { ...d[accountId], [field]: value } }));
  }

  const firstEnabledPlatform =
    (["linkedin", "email", "instagram"] as const).find((p) => enabledPlatforms[p]) ?? "linkedin";

  const [showNewAccountForm, setShowNewAccountForm] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPlatform, setNewPlatform] = useState<"linkedin" | "instagram" | "email">(firstEnabledPlatform);
  const noPlatformsEnabled = !enabledPlatforms.linkedin && !enabledPlatforms.email && !enabledPlatforms.instagram;

  function createAccount() {
    const label = newLabel.trim();
    if (!label) {
      showToast({ title: "Label required", description: "Give this account a name first.", variant: "error" });
      return;
    }
    startTransition(async () => {
      const result = await createOutreachAccountAction({ label, platform: newPlatform });
      if (!result.ok) {
        showToast({ title: "Couldn't add account", description: result.error, variant: "error" });
        return;
      }
      setNewLabel("");
      setShowNewAccountForm(false);
      reload();
      showToast({ title: "Account added", description: `${label} is ready to configure.`, variant: "success" });
    });
  }

  function removeAccount(account: AccountHealthRow) {
    if (!window.confirm(`Remove ${account.label}? This stops the agent from running on it.`)) return;
    startTransition(async () => {
      const result = await deleteOutreachAccountAction(account.id);
      if (!result.ok) {
        showToast({ title: "Couldn't remove account", description: result.error, variant: "error" });
        return;
      }
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      showToast({ title: "Removed", description: `${account.label} deleted.`, variant: "success" });
    });
  }

  function saveDraft(account: AccountHealthRow) {
    const draft = drafts[account.id];
    if (!draft) return;

    const payload: AccountDraftInput = { runTime: draft.runTime || undefined };
    if (account.platform !== "email") {
      payload.proxyHost = draft.proxyHost;
      payload.proxyPort = draft.proxyPort;
      payload.proxyUsername = draft.proxyUsername;
      // Empty submit = leave the existing encrypted password untouched --
      // only send it when the user actually typed something.
      if (draft.proxyPassword) payload.proxyPassword = draft.proxyPassword;
    }

    startTransition(async () => {
      const result = await saveAccountDraftAction(account.id, payload);
      if (!result.ok) {
        showToast({ title: "Save failed", description: result.error, variant: "error" });
        return;
      }
      // Clear the typed password back out of the draft (and mark the
      // account as now having one) so the masked placeholder takes over
      // again instead of showing the just-typed plaintext.
      if (draft.proxyPassword) {
        setDraftField(account.id, "proxyPassword", "");
        setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, hasProxyPassword: true } : a)));
      }
      showToast({ title: "Saved", description: `${account.label} updated.`, variant: "success" });
    });
  }

  function toggleRedistribute(account: AccountHealthRow) {
    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, redistributeFlag: !a.redistributeFlag } : a))
    );
    startTransition(async () => {
      const result = await toggleRedistributeAction(account.id);
      if (!result.ok) {
        showToast({ title: "Failed", description: result.error, variant: "error" });
        setAccounts((prev) =>
          prev.map((a) => (a.id === account.id ? { ...a, redistributeFlag: account.redistributeFlag } : a))
        );
      }
    });
  }

  function resumeAccount(account: AccountHealthRow) {
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === account.id
          ? { ...a, status: "active", warningType: null, warningReason: null, redistributeFlag: false }
          : a
      )
    );
    startTransition(async () => {
      const result = await resumeAccountAction(account.id);
      if (!result.ok) {
        showToast({ title: "Failed", description: result.error, variant: "error" });
        return;
      }
      showToast({ title: "Resumed", description: `${account.label} is active again.`, variant: "success" });
    });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
            Account <span className="text-gradient">Health</span>
          </h1>
          <p className="mt-1 text-sm text-[var(--text-4)]">Nothing redistributes automatically -- that&apos;s always your call.</p>
        </div>
        {!noPlatformsEnabled && (
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setShowNewAccountForm((s) => !s)}
            className="shrink-0 rounded-lg bg-[var(--accent-from)]/15 px-3 py-1.5 text-xs font-semibold text-[var(--accent-from)] ring-1 ring-[var(--accent-from)]/30 transition-colors hover:bg-[var(--accent-from)]/25 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
          >
            + Add account
          </motion.button>
        )}
      </motion.header>

      {noPlatformsEnabled && (
        <p className="mt-4 rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 p-3.5 text-xs text-[var(--text-4)]">
          No outreach channels are enabled for this workspace yet -- contact your account manager to turn on LinkedIn, Email, or Instagram.
        </p>
      )}

      {showNewAccountForm && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass mt-4 rounded-2xl p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className={labelClass}>Account name</span>
              <input
                className={inputClass}
                placeholder="e.g. Client's LinkedIn"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Platform</span>
              <select
                className={inputClass}
                value={newPlatform}
                onChange={(e) => setNewPlatform(e.target.value as "linkedin" | "instagram" | "email")}
              >
                {/* Each option only appears when the platform admin has turned that
                    channel on for THIS workspace (see .../admin/tenants/[tenantId]'s
                    Sections tab) -- every client gets a different mix of LinkedIn/
                    Email/Instagram depending on what they've actually signed up for,
                    never a hardcoded one-size-fits-all set. */}
                {enabledPlatforms.linkedin && <option value="linkedin">LinkedIn</option>}
                {enabledPlatforms.email && <option value="email">Email</option>}
                {enabledPlatforms.instagram && <option value="instagram">Instagram</option>}
              </select>
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={createAccount}
              className="rounded-lg bg-[var(--accent-from)]/15 px-3 py-1.5 text-xs font-semibold text-[var(--accent-from)] ring-1 ring-[var(--accent-from)]/30 transition-colors hover:bg-[var(--accent-from)]/25"
            >
              Create
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => setShowNewAccountForm(false)}
              className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
            >
              Cancel
            </motion.button>
          </div>
        </motion.div>
      )}

      <div className="mt-6 space-y-3">
        {accounts.map((account, i) => {
          const draft = drafts[account.id] ?? draftFrom(account);
          const isEmail = account.platform === "email";
          return (
            <motion.div
              key={account.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass glass-hover rounded-2xl p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-1)]">{account.label}</p>
                  <p className="text-[11px] uppercase tracking-wide text-[var(--text-5)]">{account.platform}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!isEmail && (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                        LOGIN_STATUS_STYLE[account.loginStatus] || LOGIN_STATUS_STYLE.not_connected
                      }`}
                    >
                      {LOGIN_STATUS_LABEL[account.loginStatus] || account.loginStatus}
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                      STATUS_STYLE[account.status] || "bg-[var(--surface-2)] text-[var(--text-4)] ring-1 ring-[var(--border-hairline-strong)]"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[account.status] || "bg-[var(--text-5)]"} ${
                        account.status === "active" ? "animate-pulse" : ""
                      }`}
                    />
                    {account.status}
                  </span>
                </div>
              </div>

              {!isEmail && account.loginStatus === "failed" && account.loginError && (
                <div className="mt-3 rounded-xl border border-[var(--status-hot)]/20 bg-[var(--status-hot)]/5 p-3 text-xs text-[var(--status-hot)]">
                  <p className="font-semibold">Login failed</p>
                  <p className="mt-1 opacity-80">{account.loginError}</p>
                  {/* The generic "double-check your password" hint is actively wrong for a
                      security-checkpoint or proxy failure (loginError's other two shapes --
                      see live_login/session.py's wait_for_login()/start_login_session()) since
                      re-entering the same correct password doesn't fix either of those. Only
                      the plain 10-minute timeout is ambiguous enough (could genuinely be a
                      form that was never submitted) to still warrant the hint. */}
                  {!account.loginError.includes("asked for extra verification") &&
                    !account.loginError.includes("proxy") && (
                      <p className="mt-1 opacity-60">Double-check the email/password below and save again to retry.</p>
                    )}
                </div>
              )}

              <p className="mt-3 text-xs text-[var(--text-5)]">
                Warm-up cap: {account.warmupCurrentLimit} (ramps automatically, not editable)
              </p>

              <ReachProgress account={account} />

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className={labelClass}>Run time</span>
                  <input
                    type="time"
                    className={inputClass}
                    value={draft.runTime}
                    onChange={(e) => setDraftField(account.id, "runTime", e.target.value)}
                  />
                </label>

                {isEmail ? (
                  <>
                    <label className="block">
                      <span className={labelClass}>Email limit/day</span>
                      <div
                        className={`${inputClass} flex cursor-not-allowed items-center opacity-70`}
                        title="Set by your account manager -- not tenant-editable"
                      >
                        {account.emailDailyLimit}
                      </div>
                    </label>
                    <label className="block">
                      <span className={labelClass}>This month</span>
                      <div
                        className={`${inputClass} flex cursor-not-allowed items-center opacity-70`}
                        title="Monthly cap set by your account manager -- not tenant-editable"
                      >
                        {account.sentThisMonth} / {account.emailMonthlyLimit}
                      </div>
                    </label>
                    <label className="block">
                      <span className={labelClass}>From email</span>
                      <div
                        className={`${inputClass} flex cursor-not-allowed items-center opacity-70`}
                        title="Set by your account manager -- not tenant-editable"
                      >
                        {account.sesFromEmail || "not set"}
                      </div>
                    </label>
                    <label className="col-span-2 block sm:col-span-3">
                      <span className={labelClass}>From name</span>
                      <div
                        className={`${inputClass} flex cursor-not-allowed items-center opacity-70`}
                        title="Set by your account manager -- not tenant-editable"
                      >
                        {account.sesFromName || "not set"}
                      </div>
                    </label>
                  </>
                ) : (
                  <>
                    <div className="col-span-2 sm:col-span-3">
                      <span className={labelClass}>
                        {account.platform === "instagram" ? "Instagram" : "LinkedIn"} login
                      </span>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {account.loginStatus === "connected" ? (
                          <>
                            <span className="text-xs text-[var(--text-4)]">
                              Connected{account.loginConnectedAt ? ` on ${new Date(account.loginConnectedAt).toLocaleDateString()}` : ""}
                            </span>
                            <button
                              onClick={() => openConnectModal(account)}
                              className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
                            >
                              Reconnect
                            </button>
                            <button
                              onClick={() => disconnectAccount(account)}
                              disabled={disconnectingId === account.id}
                              className="rounded-lg bg-[var(--status-hot)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--status-hot)] transition-colors hover:bg-[var(--status-hot)]/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {disconnectingId === account.id ? "Disconnecting…" : "Disconnect"}
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => openImportModal(account)}
                                className="rounded-lg bg-[var(--accent-from)]/15 px-3 py-1.5 text-xs font-semibold text-[var(--accent-from)] ring-1 ring-[var(--accent-from)]/30 transition-colors hover:bg-[var(--accent-from)]/25"
                              >
                                Connect via extension
                              </button>
                              <span className="rounded-full bg-[#4fd293]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#4fd293]">
                                Recommended
                              </span>
                            </span>
                            <button
                              onClick={() => openConnectModal(account)}
                              disabled={!account.proxyHost || (account.loginStatus === "connecting" && !isStaleConnecting(account))}
                              className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {account.loginStatus === "connecting" && !isStaleConnecting(account)
                                ? "Connecting…"
                                : "Connect account (browser)"}
                            </button>
                          </>
                        )}
                      </div>
                      <span className="mt-1 block text-[10px] leading-snug text-[var(--text-5)]">
                        Extension: log in on your own device, no remote browser window.{" "}
                        {account.proxyHost
                          ? "Or connect via a live window using this account's proxy -- never seen or stored by Nexaris."
                          : "The browser option needs a proxy set up below first."}
                      </span>
                    </div>
                    <label className="block">
                      <span className={labelClass}>
                        {account.platform === "instagram" ? "IG limit/day" : "LinkedIn limit/day"}
                      </span>
                      <div
                        className={`${inputClass} flex cursor-not-allowed items-center opacity-70`}
                        title="Set by your account manager -- not tenant-editable"
                      >
                        {account.platform === "instagram" ? account.igDailyLimit : account.linkedinDailyLimit}
                      </div>
                    </label>
                    <label className="block">
                      <span className={labelClass}>This month</span>
                      <div
                        className={`${inputClass} flex cursor-not-allowed items-center opacity-70`}
                        title="Monthly cap set by your account manager -- not tenant-editable"
                      >
                        {account.sentThisMonth} /{" "}
                        {account.platform === "instagram" ? account.igMonthlyLimit : account.linkedinMonthlyLimit}
                      </div>
                    </label>
                    <label className="block">
                      <span className={labelClass}>Proxy host</span>
                      <input
                        className={inputClass}
                        placeholder="none yet"
                        value={draft.proxyHost}
                        onChange={(e) => setDraftField(account.id, "proxyHost", e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelClass}>Proxy port</span>
                      <input
                        className={inputClass}
                        value={draft.proxyPort}
                        onChange={(e) => setDraftField(account.id, "proxyPort", e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelClass}>Proxy username</span>
                      <input
                        className={inputClass}
                        value={draft.proxyUsername}
                        onChange={(e) => setDraftField(account.id, "proxyUsername", e.target.value)}
                      />
                    </label>
                    <label className="col-span-2 block sm:col-span-3">
                      <span className={labelClass}>Proxy password</span>
                      <input
                        type="password"
                        className={inputClass}
                        placeholder={account.hasProxyPassword ? "•••••••• (unchanged)" : "none set"}
                        value={draft.proxyPassword}
                        onChange={(e) => setDraftField(account.id, "proxyPassword", e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                    {account.verifiedProxyIp && (
                      <p className="col-span-2 text-xs text-[var(--text-5)] sm:col-span-3">
                        Verified proxy IP: <span className="text-[var(--text-3)]">{account.verifiedProxyIp}</span> --
                        every run checks this account is still exiting through this exact IP, and refuses to
                        proceed if it ever changes. Editing the proxy host/port/username above resets this baseline.
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="mt-3 flex items-center gap-3">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => saveDraft(account)}
                  className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
                >
                  Save
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => removeAccount(account)}
                  className="rounded-lg bg-[var(--status-hot)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--status-hot)] transition-colors hover:bg-[var(--status-hot)]/20 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
                >
                  Remove
                </motion.button>
              </div>

              {account.warningType && (
                <div className="mt-3 rounded-xl border border-[var(--status-warm)]/20 bg-[var(--status-warm)]/5 p-3 text-xs text-[var(--status-warm)]">
                  <p className="font-semibold">{account.warningType}</p>
                  {account.warningReason && <p className="mt-1 opacity-70">{account.warningReason}</p>}
                </div>
              )}

              {account.status === "paused" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => toggleRedistribute(account)}
                    className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
                  >
                    {account.redistributeFlag ? "Cancel redistribution" : "Redistribute its quota"}
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => resumeAccount(account)}
                    className="rounded-lg bg-[#4fd293]/15 px-3 py-1.5 text-xs font-semibold text-[#3fb87e] ring-1 ring-[#4fd293]/30 transition-colors hover:bg-[#4fd293]/25 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
                  >
                    Resume account
                  </motion.button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {connectingAccount && (
        <ConnectAccountModal
          open={!!connectingAccount}
          onOpenChange={(open) => {
            if (!open) setConnectingAccount(null);
          }}
          accountId={connectingAccount.id}
          accountLabel={connectingAccount.label}
        />
      )}
      {importingAccount && (
        <ImportSessionModal
          open={!!importingAccount}
          onOpenChange={(open) => {
            if (!open) setImportingAccount(null);
          }}
          accountId={importingAccount.id}
          accountLabel={importingAccount.label}
        />
      )}
    </div>
  );
}
