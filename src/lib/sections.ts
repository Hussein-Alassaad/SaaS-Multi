/**
 * Per-product catalog of toggleable sections, used by the admin feature-flag
 * page and by each product's tenant-facing nav to decide what to show a
 * given tenant. Keyed by Product.slug so this naturally extends to Gym/
 * Outreach later -- add their entry here once those products have real
 * pages, nothing else needs to change.
 *
 * `key` matches a FeatureFlag.key value (scope: "TENANT", scopeId: tenantId).
 * `href` matches the corresponding NAV_ITEMS href so the sidebar can filter
 * by it directly.
 */
export interface SectionDef {
  key: string;
  label: string;
  href: string;
  /** Core sections can't be turned off -- every tenant always has them. */
  core?: boolean;
}

export const PRODUCT_SECTIONS: Record<string, SectionDef[]> = {
  marketing: [
    { key: "dashboard", label: "Dashboard", href: "/agency", core: true },
    { key: "inbox", label: "Live Inbox", href: "/agency/inbox" },
    { key: "ai-control", label: "AI Control Center", href: "/agency/ai-control" },
    { key: "pipeline", label: "Pipeline", href: "/agency/pipeline" },
    { key: "approvals", label: "Approval Queue", href: "/agency/approvals" },
    { key: "clients", label: "Clients", href: "/agency/clients" },
    { key: "meetings", label: "Calendar & Meetings", href: "/agency/meetings" },
    { key: "knowledge-base", label: "Knowledge Base", href: "/agency/knowledge-base" },
    { key: "integrations", label: "Integrations", href: "/agency/integrations" },
    { key: "analytics", label: "Analytics", href: "/agency/analytics" },
    { key: "feature-requests", label: "Feature Requests", href: "/agency/feature-requests" },
    { key: "team", label: "Team", href: "/agency/team" },
    { key: "settings", label: "Settings", href: "/agency/settings", core: true },
  ],
};

export function getSectionsForProduct(productSlug: string): SectionDef[] {
  return PRODUCT_SECTIONS[productSlug] ?? [];
}

/**
 * Where a tenant of a given product lands after login, and which public
 * login page they use. Centralized here (not hardcoded in auth actions)
 * since it's needed by login redirect, logout redirect, and the
 * cross-product route guard that stops e.g. a Marketing tenant's session
 * from rendering Outreach's layout if they navigate there directly.
 */
export const PRODUCT_DASHBOARD_PATH: Record<string, string> = {
  marketing: "/agency",
  outreach: "/outreach",
};

export const PRODUCT_LOGIN_PATH: Record<string, string> = {
  marketing: "/agency-login",
  outreach: "/outreach-login",
};
