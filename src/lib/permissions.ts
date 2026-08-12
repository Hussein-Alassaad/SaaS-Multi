/**
 * Role -> permission matrix and guard helpers.
 * Roles and permissions are also stored as data in the DB (Role/Permission
 * models) so they can be edited at runtime from /admin/roles; this file
 * provides the canonical seed matrix and small runtime helpers used by
 * server code that isn't a full DB round trip.
 */

export const SYSTEM_ROLES = [
  "Owner",
  "Developer",
  "Support",
  "Finance",
  "Sales",
  "Marketing",
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const RESOURCES = [
  "dashboard",
  "tenants",
  "subscriptions",
  "billing",
  "ai",
  "notifications",
  "feature-flags",
  "feature-requests",
  "audit-logs",
  "monitoring",
  "roles",
  "security",
] as const;
export type Resource = (typeof RESOURCES)[number];

export type Action = "view" | "create" | "edit" | "delete" | "manage";

type PermissionMatrix = Record<SystemRole, Partial<Record<Resource, Action[]>>>;

const ALL_ACTIONS: Action[] = ["view", "create", "edit", "delete", "manage"];
const allResources = (actions: Action[]) =>
  Object.fromEntries(RESOURCES.map((r) => [r, actions])) as Partial<Record<Resource, Action[]>>;

export const PERMISSION_MATRIX: PermissionMatrix = {
  Owner: allResources(ALL_ACTIONS),
  Developer: {
    dashboard: ["view"],
    "feature-flags": ALL_ACTIONS,
    "feature-requests": ALL_ACTIONS,
    monitoring: ALL_ACTIONS,
    "audit-logs": ["view"],
    ai: ["view", "edit", "manage"],
    tenants: ["view"],
  },
  Support: {
    dashboard: ["view"],
    tenants: ["view", "edit"],
    notifications: ["view", "create"],
    "audit-logs": ["view"],
    "feature-requests": ["view", "edit"],
  },
  Finance: {
    dashboard: ["view"],
    billing: ALL_ACTIONS,
    subscriptions: ALL_ACTIONS,
    tenants: ["view"],
    "audit-logs": ["view"],
  },
  Sales: {
    dashboard: ["view"],
    tenants: ["view", "create", "edit"],
    subscriptions: ["view", "edit"],
  },
  Marketing: {
    dashboard: ["view"],
    notifications: ALL_ACTIONS,
    tenants: ["view"],
  },
};

export function can(role: SystemRole | string, resource: Resource, action: Action): boolean {
  const matrix = PERMISSION_MATRIX[role as SystemRole];
  if (!matrix) return false;
  const actions = matrix[resource];
  if (!actions) return false;
  return actions.includes(action) || actions.includes("manage");
}

export function guard(role: SystemRole | string, resource: Resource, action: Action = "view") {
  if (!can(role, resource, action)) {
    throw new Error(`Forbidden: role "${role}" cannot ${action} ${resource}`);
  }
}
