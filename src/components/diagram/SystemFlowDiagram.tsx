"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Pause, Play, Grid3x3, Square } from "lucide-react";

type NodeStatus = "done" | "pending" | "todo";

interface DiagramNode {
  id: string;
  label: string;
  eyebrow: string;
  x: number;
  y: number;
  status: NodeStatus;
}

interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  kind: "primary" | "secondary";
}

const NODES: DiagramNode[] = [
  { id: "products", label: "Products", eyebrow: "REGISTRY", x: 60, y: 160, status: "done" },
  { id: "tenants", label: "Tenants", eyebrow: "CRM", x: 260, y: 80, status: "done" },
  { id: "users", label: "Users", eyebrow: "IDENTITY", x: 260, y: 240, status: "done" },
  { id: "billing", label: "Billing", eyebrow: "REVENUE", x: 480, y: 40, status: "done" },
  { id: "ai", label: "AI Engine", eyebrow: "INFERENCE", x: 480, y: 160, status: "pending" },
  { id: "support", label: "Support", eyebrow: "TICKETS", x: 480, y: 280, status: "todo" },
  { id: "audit", label: "Audit Log", eyebrow: "COMPLIANCE", x: 700, y: 100, status: "done" },
  { id: "webhooks", label: "Webhooks", eyebrow: "EGRESS", x: 700, y: 220, status: "pending" },
];

const EDGES: DiagramEdge[] = [
  { from: "products", to: "tenants", label: "provisions", kind: "primary" },
  { from: "products", to: "users", label: "scopes", kind: "secondary" },
  { from: "tenants", to: "billing", label: "subscribes", kind: "primary" },
  { from: "tenants", to: "ai", label: "consumes", kind: "primary" },
  { from: "users", to: "ai", label: "requests", kind: "secondary" },
  { from: "tenants", to: "support", label: "files", kind: "secondary" },
  { from: "billing", to: "audit", label: "logs", kind: "primary" },
  { from: "ai", to: "audit", label: "logs", kind: "primary" },
  { from: "ai", to: "webhooks", label: "emits", kind: "secondary" },
  { from: "support", to: "webhooks", label: "notifies", kind: "secondary" },
];

const STATUS_COLOR: Record<NodeStatus, string> = {
  done: "var(--dg-done)",
  pending: "var(--dg-pending)",
  todo: "var(--dg-todo)",
};

const NODE_W = 128;
const NODE_H = 56;

function nodeCenter(n: DiagramNode) {
  return { cx: n.x + NODE_W / 2, cy: n.y + NODE_H / 2 };
}

export function SystemFlowDiagram() {
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [flattened, setFlattened] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const connectedNodeIds = hovered
    ? new Set(
        EDGES.filter((e) => e.from === hovered || e.to === hovered).flatMap((e) => [e.from, e.to])
      )
    : null;
  const connectedEdges = hovered
    ? new Set(EDGES.filter((e) => e.from === hovered || e.to === hovered).map((e) => `${e.from}-${e.to}`))
    : null;

  return (
    <div className={cn("diagram-scope rounded-xl border overflow-hidden")} style={{ borderColor: "var(--dg-line)" }}>
      <div
        className="flex items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: "var(--dg-line)", background: "var(--dg-panel)", fontFamily: "var(--dg-font-mono)" }}
      >
        <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--dg-muted)" }}>
          system.dataflow — products → tenants → ai / billing
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAnimationsEnabled((v) => !v)}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px]"
            style={{ color: "var(--dg-ink)", background: "var(--dg-ground)" }}
          >
            {animationsEnabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {animationsEnabled ? "Disable motion" : "Enable motion"}
          </button>
          <button
            onClick={() => setFlattened((v) => !v)}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px]"
            style={{ color: "var(--dg-ink)", background: "var(--dg-ground)" }}
          >
            {flattened ? <Grid3x3 className="h-3 w-3" /> : <Square className="h-3 w-3" />}
            {flattened ? "Show grid" : "Flatten"}
          </button>
        </div>
      </div>

      <div
        className={cn("diagram-grid relative overflow-auto", flattened && "flattened", !animationsEnabled && "animations-disabled")}
        style={{
          background: flattened ? "var(--dg-ground)" : undefined,
          backgroundColor: "var(--dg-ground)",
          cursor: "grab",
          height: 380,
        }}
      >
        {/* radial vignette */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(circle at 50% 40%, transparent 40%, rgba(0,0,0,0.35) 100%)",
          }}
        />

        <svg viewBox="0 0 860 360" className="relative w-full min-w-[720px]" style={{ height: 380 }} role="img" aria-label="System data flow diagram showing Products provisioning Tenants, which consume AI and Billing services, all logging to Audit and emitting Webhooks">
          <defs>
            <marker id="dg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--dg-accent)" />
            </marker>
          </defs>

          {EDGES.map((e) => {
            const from = NODES.find((n) => n.id === e.from)!;
            const to = NODES.find((n) => n.id === e.to)!;
            const a = nodeCenter(from);
            const b = nodeCenter(to);
            const edgeKey = `${e.from}-${e.to}`;
            const dim = connectedEdges ? !connectedEdges.has(edgeKey) : false;

            return (
              <g key={edgeKey} opacity={dim ? 0.1 : 1} style={{ transition: "opacity 200ms" }}>
                <line
                  x1={a.cx}
                  y1={a.cy}
                  x2={b.cx}
                  y2={b.cy}
                  stroke="var(--dg-line)"
                  strokeWidth={1.5}
                  strokeDasharray={e.kind === "secondary" ? "4 3" : undefined}
                />
                <line
                  x1={a.cx}
                  y1={a.cy}
                  x2={b.cx}
                  y2={b.cy}
                  stroke="var(--dg-accent)"
                  strokeWidth={1.5}
                  strokeOpacity={e.kind === "primary" ? 0.8 : 0.45}
                  strokeDasharray="6 6"
                  markerEnd="url(#dg-arrow)"
                  className={animationsEnabled ? (e.kind === "primary" ? "flow-line-primary" : "flow-line-secondary") : undefined}
                />
                <text
                  x={(a.cx + b.cx) / 2}
                  y={(a.cy + b.cy) / 2 - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--dg-muted)"
                  fontFamily="var(--dg-font-mono)"
                >
                  {e.label}
                </text>
              </g>
            );
          })}

          {NODES.map((n, i) => {
            const dim = connectedNodeIds ? !connectedNodeIds.has(n.id) : false;
            const isHovered = hovered === n.id;
            return (
              <motion.g
                key={n.id}
                initial={animationsEnabled ? { opacity: 0, scale: 0.82, y: 12 } : false}
                animate={{ opacity: dim ? 0.12 : 1, scale: 1, y: 0 }}
                transition={{
                  delay: animationsEnabled ? i * 0.08 : 0,
                  duration: 0.5,
                  ease: [0.22, 0.85, 0.3, 1.1],
                }}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
              >
                <foreignObject x={n.x} y={n.y} width={NODE_W} height={NODE_H}>
                  <div
                    className={cn("h-full w-full rounded-lg border px-3 py-2", animationsEnabled && (n.status === "done" || n.status === "pending") && "node-breathing")}
                    style={{
                      background: "var(--dg-panel)",
                      borderColor: isHovered ? "var(--dg-accent)" : "var(--dg-line)",
                      fontFamily: "var(--dg-font-mono)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] tracking-wider" style={{ color: "var(--dg-muted)" }}>
                        {n.eyebrow}
                      </span>
                      <span className="relative flex h-2 w-2">
                        <span
                          className={cn(
                            "relative inline-flex h-2 w-2 rounded-full",
                            animationsEnabled && n.status !== "todo" && "status-dot-pulse"
                          )}
                          style={{ background: STATUS_COLOR[n.status], color: STATUS_COLOR[n.status] }}
                        />
                      </span>
                    </div>
                    <div className="text-[13px] font-medium" style={{ color: "var(--dg-ink)" }}>
                      {n.label}
                    </div>
                  </div>
                </foreignObject>
              </motion.g>
            );
          })}
        </svg>
      </div>

      <div
        className="flex flex-wrap items-center gap-4 border-t px-4 py-2.5 text-[11px]"
        style={{ borderColor: "var(--dg-line)", background: "var(--dg-panel)", fontFamily: "var(--dg-font-mono)", color: "var(--dg-muted)" }}
      >
        <LegendDot color="var(--dg-done)" label="Done" />
        <LegendDot color="var(--dg-pending)" label="Pending" />
        <LegendDot color="var(--dg-todo)" label="Todo" />
        <span className="ml-auto">hover a node to trace its connections</span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
