"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { mintImportSessionCodeAction } from "@/lib/actions/outreach-live-login";

/**
 * The Nexaris Connect Chrome extension's counterpart to
 * ConnectAccountModal.tsx's VNC flow -- shown when a tenant clicks
 * "Connect via extension" on Account Health instead of "Connect account".
 * Doesn't open any live browser/stream itself: mints a short-lived code
 * (mintImportSessionCodeAction, 10 min) and shows it for the tenant to
 * copy into the extension's own popup, where they log into LinkedIn/
 * Instagram normally and paste it in. This modal has no way to know when
 * that finishes on its own (no persistent connection to poll a live
 * session against, unlike VNC) -- deliberately relies on
 * AccountHealthClient's OWN existing realtime subscription on
 * outreach_accounts (not a second one here -- would just double the
 * subscription for no benefit) to re-render this account as "Connected"
 * once /api/extension/import-session's backend write lands, same as any
 * other account-row realtime update the dashboard already reacts to.
 */
export function ImportSessionModal({
  open,
  onOpenChange,
  accountId,
  accountLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountLabel: string;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  // The parent only ever renders this component at all while its own
  // `open`-tracking state is truthy (see AccountHealthClient.tsx's
  // `{importingAccount && <ImportSessionModal .../>}`) -- closing sets
  // that to null, which unmounts this component rather than re-rendering
  // it with open=false. So `open` is always true for this component's
  // entire mounted lifetime; a fresh mount (i.e. accountId changing) is
  // the only time this needs to re-mint a code, and mounting fresh already
  // gives every state variable its initial value with no explicit reset
  // needed here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await mintImportSessionCodeAction(accountId);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCode(result.code);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const copyCode = useCallback(() => {
    if (!code) return;
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        showToast({ title: "Copied", description: "Code copied to clipboard.", variant: "success" });
      })
      .catch(() => {
        showToast({ title: "Couldn't copy", description: "Select and copy the code manually.", variant: "error" });
      });
  }, [code, showToast]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Connect ${accountLabel} via extension`}
      description="No remote browser window -- log in on your own device, then paste this code into the extension."
    >
      <div className="space-y-4">
        <ol className="list-decimal space-y-2 pl-4 text-sm text-[var(--text-2)]">
          <li>
            Install the{" "}
            <span className="font-semibold text-[var(--text-1)]">Nexaris Connect</span> extension in
            Chrome (your account manager can send you the link if you don&apos;t have it yet).
          </li>
          <li>Log into LinkedIn or Instagram normally, in your own browser.</li>
          <li>Click the Nexaris Connect icon in your browser toolbar.</li>
          <li>Paste the code below into the extension, then click Connect there.</li>
        </ol>

        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-3)]">Code (valid for 10 minutes)</span>
          {error ? (
            <p className="text-sm text-[var(--status-hot)]">{error}</p>
          ) : code ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-xs text-[var(--text-1)]">
                {code}
              </code>
              <Button size="sm" variant="outline" onClick={copyCode}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-4)]">Generating code...</p>
          )}
        </div>

        <p className="text-xs text-[var(--text-5)]">
          This page will update automatically once the account connects -- no need to keep this open.
        </p>
      </div>
    </Modal>
  );
}
