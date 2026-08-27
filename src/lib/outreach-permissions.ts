/**
 * Tenant-side role -> permission matrix and guard helpers for Outreach
 * (AI lead-discovery & outreach agent). Deliberately separate from
 * src/lib/agency-permissions.ts: Outreach resources (leads, accounts,
 * run-status) are semantically distinct from Nexaris resources (inbox,
 * knowledge-base), and Outreach's role set (Owner/Manager/Operator) is
 * flatter -- it has no historical precedent of differentiated roles the
 * way Nexaris does, since the pre-rebuild version had exactly 2
 * undifferentiated users. Keeping the matrices apart makes cross-use a
 * compile error instead of a silent bug (same rationale as agency-permissions.ts).
 */

export const OUTREACH_ROLES = ["Owner", "Manager", "Operator"] as const;
export type OutreachRole = (typeof OUTREACH_ROLES)[number];

// DB Role.name is globally unique; "Owner"/"Manager" collide with both
// platform roles and Agency roles, so Outreach roles are stored under a
// distinguishing name. UI labels always use the plain OutreachRole value.
export function outreachRoleDbName(role: OutreachRole): string {
  return `Outreach ${role}`;
}

export const OUTREACH_RESOURCES = [
  "dashboard",
  "approvals",
  "replies",
  "instagram-manual",
  "linkedin",
  "email",
  "pipeline",
  "leads",
  "clients",
  "client-history",
  "analytics",
  "accounts",
  "run-status",
  "errors",
  "settings",
  "feature-requests",
] as const;
export type OutreachResource = (typeof OUTREACH_RESOURCES)[number];

export type OutreachAction = "view" | "create" | "edit" | "delete" | "manage";

type OutreachPermissionMatrix = Record<OutreachRole, Partial<Record<OutreachResource, OutreachAction[]>>>;

const ALL_ACTIONS: OutreachAction[] = ["view", "create", "edit", "delete", "manage"];
const allResources = (actions: OutreachAction[]) =>
  Object.fromEntries(OUTREACH_RESOURCES.map((r) => [r, actions])) as Partial<
    Record<OutreachResource, OutreachAction[]>
  >;

export const OUTREACH_PERMISSION_MATRIX: OutreachPermissionMatrix = {
  Owner: allResources(ALL_ACTIONS),
  Manager: {
    dashboard: ["view"],
    approvals: ALL_ACTIONS,
    replies: ALL_ACTIONS,
    "instagram-manual": ALL_ACTIONS,
    linkedin: ["view"],
    email: ["view"],
    pipeline: ALL_ACTIONS,
    leads: ALL_ACTIONS,
    clients: ["view"],
    "client-history": ["view"],
    analytics: ["view"],
    accounts: ALL_ACTIONS,
    "run-status": ["view"],
    errors: ["view", "edit"],
    settings: ALL_ACTIONS,
    "feature-requests": ["view", "create"],
  },
  Operator: {
    dashboard: ["view"],
    approvals: ["view", "edit"], // approve/hold/edit messages, not settings/accounts
    replies: ["view", "edit"], // read threads and send replies, not settings/accounts
    "instagram-manual": ["view", "edit"],
    linkedin: ["view"],
    email: ["view"],
    pipeline: ["view"],
    leads: ["view", "edit"], // notes/follow-ups, not deletion
    clients: ["view"],
    "client-history": ["view"],
    analytics: ["view"],
    "run-status": ["view"],
    errors: ["view"],
  },
};

// Session role names come from the DB (Role.name, e.g. "Outreach Owner");
// strip the storage prefix so callers can pass either that or the plain
// OutreachRole label transparently.
function normalizeOutreachRole(role: string): string {
  return role.startsWith("Outreach ") ? role.slice("Outreach ".length) : role;
}

export function outreachCan(role: OutreachRole | string, resource: OutreachResource, action: OutreachAction): boolean {
  const matrix = OUTREACH_PERMISSION_MATRIX[normalizeOutreachRole(role) as OutreachRole];
  if (!matrix) return false;
  const actions = matrix[resource];
  if (!actions) return false;
  return actions.includes(action) || actions.includes("manage");
}

export function outreachGuard(role: OutreachRole | string, resource: OutreachResource, action: OutreachAction = "view") {
  if (!outreachCan(role, resource, action)) {
    throw new Error(`Forbidden: role "${role}" cannot ${action} ${resource}`);
  }
}

/**
 * Server actions here are invoked directly from interactive client
 * components (approve/hold swipe gestures, drag-and-drop), same rationale
 * as agencyGuardResult(): converts a throw into {ok:false, error} so a
 * permission failure doesn't crash the whole page via React's error boundary.
 */
export function outreachGuardResult(
  role: OutreachRole | string,
  resource: OutreachResource,
  action: OutreachAction = "view"
): { ok: true } | { ok: false; error: string } {
  if (!outreachCan(role, resource, action)) {
    return { ok: false, error: `You don't have permission to ${action} ${resource}.` };
  }
  return { ok: true };
}
