"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { startConnectAccountAction, cancelConnectAccountAction } from "@/lib/actions/outreach-live-login";

// Must match the viewport live_login/session.py launches the browser at --
// frame pixels and click coordinates are both in this exact space, so the
// canvas is rendered 1:1 with no scaling math needed.
const VIEWPORT_WIDTH = 1366;
const VIEWPORT_HEIGHT = 768;

type SessionState = "starting" | "streaming" | "success" | "error";

interface ServerMessage {
  type: "frame" | "success" | "error";
  data?: string;
  message?: string;
}

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  const closeSocket = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const cleanupAndClose = useCallback(
    (nextState: SessionState, message?: string) => {
      closeSocket();
      setState(nextState);
      if (message) setErrorMessage(message);
    },
    [closeSocket]
  );

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

      const ws = new WebSocket(`${result.wsUrl}?token=${encodeURIComponent(result.token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) setState("streaming");
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === "frame" && msg.data) {
          drawFrame(canvasRef.current, msg.data);
        } else if (msg.type === "success") {
          cleanupAndClose("success");
          router.refresh();
          showToast({ title: "Connected", description: `${accountLabel} is now connected.`, variant: "success" });
        } else if (msg.type === "error") {
          cleanupAndClose("error", msg.message ?? "The connection attempt failed.");
        }
      };

      ws.onerror = () => {
        if (!cancelled) cleanupAndClose("error", "Lost connection to the login server.");
      };

      ws.onclose = (event) => {
        if (cancelled) return;
        // A clean close after success/error already set state above -- only
        // treat an unexpected close (still "streaming") as a failure.
        setState((prev) => {
          if (prev === "streaming") {
            void cancelConnectAccountAction(accountId);
            setErrorMessage(event.reason || "Connection closed unexpectedly.");
            return "error";
          }
          return prev;
        });
      };
    })();

    return () => {
      cancelled = true;
      closeSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs only when the modal opens/accountId changes, not on every render
  }, [open, accountId]);

  const sendInput = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const toCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = VIEWPORT_WIDTH / rect.width;
    const scaleY = VIEWPORT_HEIGHT / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }, []);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSocket();
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

      {state === "streaming" && (
        <div className="space-y-2">
          <canvas
            ref={canvasRef}
            width={VIEWPORT_WIDTH}
            height={VIEWPORT_HEIGHT}
            className="aspect-[1366/768] w-full cursor-pointer rounded-xl border border-[var(--border-hairline-strong)] bg-black"
            tabIndex={0}
            onMouseMove={(e) => sendInput({ type: "mousemove", ...toCanvasCoords(e) })}
            onMouseDown={(e) => sendInput({ type: "mousedown", ...toCanvasCoords(e), button: "left" })}
            onMouseUp={(e) => sendInput({ type: "mouseup", ...toCanvasCoords(e), button: "left" })}
            onKeyDown={(e) => {
              e.preventDefault();
              sendInput({ type: "keydown", key: e.key, code: e.code });
            }}
            onKeyUp={(e) => {
              e.preventDefault();
              sendInput({ type: "keyup", key: e.key, code: e.code });
            }}
          />
          <p className="text-[11px] text-[var(--text-5)]">
            Click into the window above, then type normally. This can take a minute to load the real login page.
          </p>
        </div>
      )}
    </Modal>
  );
}

function drawFrame(canvas: HTMLCanvasElement | null, base64Jpeg: string) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  };
  img.src = `data:image/jpeg;base64,${base64Jpeg}`;
}
