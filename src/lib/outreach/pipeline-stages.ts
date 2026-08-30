/**
 * Kanban stages for the Outreach Pipeline board -- matches the original
 * single-tenant app's board exactly (agent/crm/pipeline.py's STAGES).
 * Leads only enter the board once status moves past the discovery/approval
 * statuses (discovered/analyzed/awaiting_approval/approved/manual_send_pending) --
 * there is deliberately no "new"/discovery column here, matching the original.
 *
 * Split out of src/lib/outreach/leads.ts into its own file, deliberately
 * with NO other imports: leads.ts imports src/lib/db.ts (withTenant),
 * which imports src/lib/env.ts, which THROWS at module-evaluation time if
 * process.env.AUTH_SECRET is unset. PipelineClient.tsx ("use client") used
 * to import PIPELINE_STAGES/PipelineStage directly from leads.ts -- Next's
 * client bundler can't tree-shake out just the constant, so it pulled the
 * WHOLE module graph (leads.ts -> db.ts -> env.ts) into the browser
 * bundle, where process.env.AUTH_SECRET is never defined (client bundles
 * only ever get NEXT_PUBLIC_* vars) -- env.ts's own production check then
 * fired for real, in every visitor's browser, every time, crashing the
 * whole Pipeline page on load regardless of what was actually configured
 * on the server. This file has zero server-only imports specifically so
 * it's safe for a client component to import directly.
 */
export const PIPELINE_STAGES = [
  "contacted",
  "replied",
  "interested",
  "meeting_booked",
  "deal_closed",
  "lost",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
