"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RFB from "@novnc/novnc";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  startConnectAccountAction,
  cancelConnectAccountAction,
  getConnectAccountStatusAction,
} from "@/lib/actions/outreach-live-login";

type SessionState = "starting" | "streaming" | "success" | "error";

const STATUS_POLL_MS = 2000;

export function ConnectAccountModal({
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
  const [state, setState] = useState<SessionState>("starting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<InstanceType<typeof RFB> | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  const closeRfb = useCallback(() => {
    rfbRef.current?.disconnect();
    rfbRef.current = null;
  }, []);

  const cleanupAndClose = useCallback(
    (nextState: SessionState, message?: string) => {
      closeRfb();
      setState(nextState);
      if (message) setErrorMessage(message);
    },
    [closeRfb]
  );

  // Opens the VNC connection: mints the token, points noVNC's RFB client at
  // the droplet's websocket (which now proxies raw VNC bytes -- see
  // live_login/server.py -- rather than the old hand-rolled JSON frame/
  // input protocol). RFB owns the whole socket; this component never
  // parses its traffic directly.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setState("starting");
    setErrorMessage(null);

    (async () => {
      const result = await startConnectAccountAction(accountId);
      if (cancelled) return;
      if (!result.ok) {
        cleanupAndClose("error", result.error);
        return;
      }
      const screen = screenRef.current;
      if (!screen) return;

      const wsUrl = `${result.wsUrl}?token=${encodeURIComponent(result.token)}`;
      const rfb = new RFB(screen, wsUrl);
      rfb.viewOnly = false;
      rfb.scaleViewport = true;
      rfb.clipViewport = true;
      rfb.background = "#000000";
      rfbRef.current = rfb;

      rfb.addEventListener("connect", () => {
        if (!cancelled) setState("streaming");
      });

      rfb.addEventListener("disconnect", (e) => {
        if (cancelled) return;
        const clean = (e as CustomEvent<{ clean: boolean }>).detail?.clean;
        // A clean disconnect after success/error already set state above via
        // cleanupAndClose (which itself calls disconnect()) -- only an
        // UNCLEAN disconnect while still "streaming" is a real failure here.
        setState((prev) => {
          if (prev === "streaming" && !clean) {
            void cancelConnectAccountAction(accountId);
            setErrorMessage("Lost connection to the login server.");
            return "error";
          }
          return prev;
        });
      });

      rfb.addEventListener("securityfailure", () => {
        if (!cancelled) cleanupAndClose("error", "Could not establish a secure connection.");
      });
    })();

    return () => {
      cancelled = true;
      closeRfb();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs only when the modal opens/accountId changes, not on every render
  }, [open, accountId]);

  // Polls the account's real loginStatus while streaming -- replaces the
  // old websocket "success"/"error" push messages, which had nowhere left
  // to go once the socket became pure VNC protocol (see this file's other
  // comments, and live_login/server.py's own docstring, for why).
  useEffect(() => {
    if (state !== "streaming") return;
    let cancelled = false;

    const poll = async () => {
      const result = await getConnectAccountStatusAction(accountId);
      if (cancelled || !result.ok) return;

      if (result.status === "connected") {
        cleanupAndClose("success");
        router.refresh();
        showToast({ title: "Connected", description: `${accountLabel} is now connected.`, variant: "success" });
      } else if (result.status === "failed") {
        cleanupAndClose("error", result.error ?? "The connection attempt failed.");
      }
    };

    const interval = setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state, accountId, accountLabel, cleanupAndClose, router, showToast]);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) closeRfb();
        onOpenChange(next);
      }}
      title={`Connect ${accountLabel}`}
      description="Log in with the account's own email and password. Nothing you type here is seen or stored by Nexaris -- it goes directly into the real login page."
      className="max-w-3xl"
    >
      {state === "starting" && (
        <div className="flex h-96 items-center justify-center text-sm text-[var(--text-4)]">
          Starting a secure connection…
        </div>
      )}

      {state === "error" && (
        <div className="flex h-96 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-[var(--status-hot)]">{errorMessage ?? "Something went wrong."}</p>
          <button
            onClick={() => {
              setState("starting");
              setErrorMessage(null);
              // Re-trigger the effect by toggling open off/on would be
              // awkward from here -- simplest correct retry is closing the
              // modal so the caller's "Connect account" button re-opens a
              // fresh attempt from a clean state.
              onOpenChange(false);
            }}
            className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
          >
            Close
          </button>
        </div>
      )}

      {state === "success" && (
        <div className="flex h-96 items-center justify-center text-sm text-[#4fd293]">Connected successfully.</div>
      )}

      <div
        ref={screenRef}
        className="aspect-[1366/768] w-full overflow-hidden rounded-xl border border-[var(--border-hairline-strong)] bg-black"
        style={{ display: state === "streaming" ? "block" : "none" }}
      />
      {state === "streaming" && (
        <p className="mt-2 text-[11px] text-[var(--text-5)]">
          Click into the window above, then type normally. This can take a minute to load the real login page.
        </p>
      )}
    </Modal>
  );
}
