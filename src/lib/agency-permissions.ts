/**
 * Tenant-side role -> permission matrix and guard helpers for Nexaris
 * (AI Sales & Support platform). Deliberately separate from
 * src/lib/permissions.ts: tenant roles (Owner, Manager, Sales, Marketing,
 * Content Creator, Freelancer) govern tenant resources (inbox, pipeline,
 * approvals) and are semantically distinct from platform staff roles of the
 * same name, which govern admin resources (tenants, billing). Keeping the
 * matrices and types apart makes cross-use a compile error instead of a
 * silent bug.
 */

export const AGENCY_ROLES = [
  "Owner",
  "Manager",
  "Sales",
  "Marketing",
  "Content Creator",
  "Freelancer",
] as const;
export type AgencyRole = (typeof AGENCY_ROLES)[number];

// DB Role.name is globally unique; platform roles already use "Owner",
// "Sales", "Marketing" so agency roles are stored under a distinguishing
// name. UI labels always use the plain AgencyRole value, never this prefix.
export function agencyRoleDbName(role: AgencyRole): string {
  return `Agency ${role}`;
}

export const AGENCY_RESOURCES = [
  "dashboard",
  "inbox",
  "ai-control",
  "pipeline",
  "approvals",
  "clients",
  "meetings",
  "knowledge-base",
  "integrations",
  "analytics",
  "feature-requests",
  "settings",
  "team",
] as const;
export type AgencyResource = (typeof AGENCY_RESOURCES)[number];

export type AgencyAction = "view" | "create" | "edit" | "delete" | "manage";

type AgencyPermissionMatrix = Record<AgencyRole, Partial<Record<AgencyResource, AgencyAction[]>>>;

const ALL_ACTIONS: AgencyAction[] = ["view", "create", "edit", "delete", "manage"];
const allResources = (actions: AgencyAction[]) =>
  Object.fromEntries(AGENCY_RESOURCES.map((r) => [r, actions])) as Partial<
    Record<AgencyResource, AgencyAction[]>
  >;

export const AGENCY_PERMISSION_MATRIX: AgencyPermissionMatrix = {
  Owner: allResources(ALL_ACTIONS),
  Manager: {
    dashboard: ["view"],
    inbox: ALL_ACTIONS,
    "ai-control": ALL_ACTIONS,
    pipeline: ALL_ACTIONS,
    approvals: ALL_ACTIONS,
    clients: ALL_ACTIONS,
    meetings: ALL_ACTIONS,
    "knowledge-base": ALL_ACTIONS,
    integrations: ["view", "edit"],
    analytics: ["view"],
    "feature-requests": ALL_ACTIONS,
    settings: ["view", "edit"],
    team: ALL_ACTIONS,
  },
  Sales: {
    dashboard: ["view"],
    inbox: ["view", "create", "edit"],
    pipeline: ALL_ACTIONS,
    approvals: ["view", "edit"],
    clients: ["view", "edit"],
    meetings: ["view", "create", "edit"],
    "knowledge-base": ["view"],
    analytics: ["view"],
    "feature-requests": ["view", "create"],
  },
  Marketing: {
    dashboard: ["view"],
    inbox: ["view"],
    pipeline: ["view"],
    clients: ["view"],
    meetings: ["view"],
    "knowledge-base": ["view", "create", "edit"],
    analytics: ["view"],
    "feature-requests": ["view", "create"],
  },
  "Content Creator": {
    dashboard: ["view"],
    "knowledge-base": ALL_ACTIONS,
    clients: ["view"],
    "feature-requests": ["view", "create"],
  },
  Freelancer: {
    dashboard: ["view"],
    // Row-level "assigned only" scoping happens in src/lib/agency/*.ts
    // data-access functions, not here.
    inbox: ["view"],
    pipeline: ["view"],
    clients: ["view"],
    meetings: ["view"],
    "feature-requests": ["view", "create"],
  },
};

// Session role names come from the DB (Role.name, e.g. "Agency Owner");
// strip the storage prefix so callers can pass either that or the plain
// AgencyRole label transparently.
function normalizeAgencyRole(role: string): string {
  return role.startsWith("Agency ") ? role.slice("Agency ".length) : role;
}

export function agencyCan(role: AgencyRole | string, resource: AgencyResource, action: AgencyAction): boolean {
  const matrix = AGENCY_PERMISSION_MATRIX[normalizeAgencyRole(role) as AgencyRole];
  if (!matrix) return false;
  const actions = matrix[resource];
  if (!actions) return false;
  return actions.includes(action) || actions.includes("manage");
}

export function agencyGuard(role: AgencyRole | string, resource: AgencyResource, action: AgencyAction = "view") {
  if (!agencyCan(role, resource, action)) {
    throw new Error(`Forbidden: role "${role}" cannot ${action} ${resource}`);
  }
}

/**
 * Server actions here are invoked directly from interactive client
 * components (buttons, drag-and-drop), unlike the admin side where guard()
 * failures are rarely user-reachable. Letting the throw propagate crashes
 * the whole page via React's error boundary; this converts it to the
 * standard {ok:false, error} shape instead.
 */
export function agencyGuardResult(
  role: AgencyRole | string,
  resource: AgencyResource,
  action: AgencyAction = "view"
): { ok: true } | { ok: false; error: string } {
  if (!agencyCan(role, resource, action)) {
    return { ok: false, error: `You don't have permission to ${action} ${resource}.` };
  }
  return { ok: true };
}
