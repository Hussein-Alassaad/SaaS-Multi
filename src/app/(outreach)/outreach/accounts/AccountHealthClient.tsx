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
  type AccountDraftInput,
} from "@/lib/actions/outreach-accounts";

export interface AccountHealthRow {
  id: string;
  label: string;
  platform: string; // "instagram" | "linkedin" | "email"
  runTime: string; // "HH:MM:SS"
  igDailyLimit: number;
  linkedinDailyLimit: number;
  emailDailyLimit: number;
  proxyHost: string | null;
  proxyPort: string | null;
  proxyUsername: string | null;
  hasProxyPassword: boolean;
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
  igDailyLimit: string;
  linkedinDailyLimit: string;
  emailDailyLimit: string;
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string; // always starts empty -- never seeded from a decrypted value
  sesFromEmail: string;
  sesFromName: string;
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

const inputClass =
  "mt-1 w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-2.5 py-1.5 text-xs text-[var(--text-2)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]";
const labelClass = "text-[11px] font-medium uppercase tracking-wide text-[var(--text-5)]";

function draftFrom(account: AccountHealthRow): AccountDraft {
  return {
    runTime: (account.runTime || "").slice(0, 5), // "HH:MM:SS" -> "HH:MM" for <input type="time">
    igDailyLimit: String(account.igDailyLimit ?? ""),
    linkedinDailyLimit: String(account.linkedinDailyLimit ?? ""),
    emailDailyLimit: String(account.emailDailyLimit ?? ""),
    proxyHost: account.proxyHost || "",
    proxyPort: account.proxyPort || "",
    proxyUsername: account.proxyUsername || "",
    proxyPassword: "",
    sesFromEmail: account.sesFromEmail || "",
    sesFromName: account.sesFromName || "",
  };
}

export function AccountHealthClient({
  tenantId,
  initialAccounts,
}: {
  tenantId: string;
  initialAccounts: AccountHealthRow[];
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

  function saveDraft(account: AccountHealthRow) {
    const draft = drafts[account.id];
    if (!draft) return;

    const payload: AccountDraftInput = { runTime: draft.runTime || undefined };
    if (account.platform === "email") {
      const emailLimit = Number(draft.emailDailyLimit);
      if (!Number.isNaN(emailLimit)) payload.emailDailyLimit = emailLimit;
      payload.sesFromEmail = draft.sesFromEmail;
      payload.sesFromName = draft.sesFromName;
    } else {
      if (account.platform === "instagram") {
        const igLimit = Number(draft.igDailyLimit);
        if (!Number.isNaN(igLimit)) payload.igDailyLimit = igLimit;
      } else {
        const liLimit = Number(draft.linkedinDailyLimit);
        if (!Number.isNaN(liLimit)) payload.linkedinDailyLimit = liLimit;
      }
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
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          Account <span className="text-gradient">Health</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">Nothing redistributes automatically -- that&apos;s always your call.</p>
      </motion.header>

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

              <p className="mt-3 text-xs text-[var(--text-5)]">
                Warm-up cap: {account.warmupCurrentLimit} (ramps automatically, not editable)
              </p>

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
                      <input
                        type="number"
                        className={inputClass}
                        value={draft.emailDailyLimit}
                        onChange={(e) => setDraftField(account.id, "emailDailyLimit", e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelClass}>SES from email</span>
                      <input
                        className={inputClass}
                        placeholder="sender@yourdomain.com"
                        value={draft.sesFromEmail}
                        onChange={(e) => setDraftField(account.id, "sesFromEmail", e.target.value)}
                      />
                    </label>
                    <label className="col-span-2 block sm:col-span-3">
                      <span className={labelClass}>SES from name</span>
                      <input
                        className={inputClass}
                        placeholder="none set"
                        value={draft.sesFromName}
                        onChange={(e) => setDraftField(account.id, "sesFromName", e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="block">
                      <span className={labelClass}>
                        {account.platform === "instagram" ? "IG limit/day" : "LinkedIn limit/day"}
                      </span>
                      <input
                        type="number"
                        className={inputClass}
                        value={account.platform === "instagram" ? draft.igDailyLimit : draft.linkedinDailyLimit}
                        onChange={(e) =>
                          setDraftField(
                            account.id,
                            account.platform === "instagram" ? "igDailyLimit" : "linkedinDailyLimit",
                            e.target.value
                          )
                        }
                      />
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
    </div>
  );
}
