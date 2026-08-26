"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { agentControlAction } from "@/lib/actions/agent-control";

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  stopped: "Stopped",
  not_found: "Never deployed",
  unknown: "Unknown",
};
const STATUS_VARIANT: Record<string, "success" | "warm" | "outline"> = {
  running: "success",
  stopped: "warm",
  not_found: "outline",
  unknown: "outline",
};

export function AgentControlCard({ initialStatus }: { initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, startTransition] = useTransition();
  const { showToast } = useToast();

  const refresh = () => {
    startTransition(async () => {
      const result = await agentControlAction("status");
      if (result.ok) setStatus(result.status);
      else showToast({ title: "Couldn't refresh status", description: result.error, variant: "error" });
    });
  };

  const start = () => {
    startTransition(async () => {
      const result = await agentControlAction("start");
      if (result.ok) {
        setStatus(result.status);
        showToast({ title: "Agent started", description: "The scheduler is now running.", variant: "success" });
      } else {
        showToast({ title: "Couldn't start the agent", description: result.error, variant: "error" });
      }
    });
  };

  const stop = () => {
    if (
      !window.confirm(
        "Stop the outreach agent? No LinkedIn/Instagram discovery, message generation, or sending will run for ANY tenant until it's started again."
      )
    )
      return;
    startTransition(async () => {
      const result = await agentControlAction("stop");
      if (result.ok) {
        setStatus(result.status);
        showToast({ title: "Agent stopped", variant: "success" });
      } else {
        showToast({ title: "Couldn't stop the agent", description: result.error, variant: "error" });
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outreach Agent</CardTitle>
        <CardDescription>
          The always-on process that discovers leads and generates/sends messages across every Outreach
          tenant. Starting it begins real, unsupervised LinkedIn/Instagram activity.
        </CardDescription>
      </CardHeader>
      <div className="flex items-center justify-between">
        <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{STATUS_LABEL[status] ?? status}</Badge>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            disabled={pending}
            className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            onClick={start}
            disabled={pending || status === "running"}
            className="rounded-lg bg-[#4fd293]/15 px-3 py-1.5 text-xs font-semibold text-[#3fb87e] ring-1 ring-[#4fd293]/30 transition-colors hover:bg-[#4fd293]/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start
          </button>
          <button
            onClick={stop}
            disabled={pending || status !== "running"}
            className="rounded-lg bg-[var(--status-hot)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--status-hot)] transition-colors hover:bg-[var(--status-hot)]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop
          </button>
        </div>
      </div>
    </Card>
  );
}
