import { db } from "@/lib/db";
import { getSectionsForProduct, type SectionDef } from "@/lib/sections";

/**
 * Resolves which sections a tenant sees. Default is "on" for every section
 * in the tenant's product (so existing tenants with zero FeatureFlag rows
 * are unaffected) -- a section is hidden only when an explicit disabling
 * flag exists (scope: "TENANT", scopeId: tenantId, enabled: false).
 * Core sections (Dashboard, Settings) are never hidden, even if a stray
 * flag row disables them.
 */
export async function getEnabledSectionKeys(tenantId: string, productSlug: string): Promise<Set<string>> {
  const sections = getSectionsForProduct(productSlug);
  if (sections.length === 0) return new Set();

  const flags = await db.featureFlag.findMany({
    where: {
      scope: "TENANT",
      scopeId: tenantId,
      key: { in: sections.map((s) => s.key) },
    },
  });
  const disabledKeys = new Set(flags.filter((f) => !f.enabled).map((f) => f.key));

  return new Set(sections.filter((s) => s.core || !disabledKeys.has(s.key)).map((s) => s.key));
}

/**
 * Admin-facing: full list of sections for a tenant's product, each tagged
 * with its current on/off state, for rendering toggle rows.
 */
export async function getTenantSectionToggles(
  tenantId: string,
  productSlug: string
): Promise<(SectionDef & { enabled: boolean })[]> {
  const sections = getSectionsForProduct(productSlug);
  const enabledKeys = await getEnabledSectionKeys(tenantId, productSlug);
  return sections.map((s) => ({ ...s, enabled: enabledKeys.has(s.key) }));
}

/**
 * Nav-facing: enabled section hrefs for a tenant, for direct filtering of
 * NAV_ITEMS (which are keyed by href, not by section key).
 */
export async function getEnabledSectionHrefs(tenantId: string, productSlug: string): Promise<string[]> {
  const enabledKeys = await getEnabledSectionKeys(tenantId, productSlug);
  return getSectionsForProduct(productSlug)
    .filter((s) => enabledKeys.has(s.key))
    .map((s) => s.href);
}
