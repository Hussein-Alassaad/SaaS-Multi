import { redirect } from "next/navigation";
import { OutreachSidebar } from "@/components/layout/OutreachSidebar";
import { OutreachMobileTopBar } from "@/components/layout/OutreachMobileTopBar";
import { OutreachMobileBottomBar } from "@/components/layout/OutreachMobileBottomBar";
import { AmbientWordmark } from "@/components/layout/AmbientWordmark";
import { PageTransition } from "@/components/layout/PageTransition";
import { OutreachRealtimeToasts } from "@/components/outreach/OutreachRealtimeToasts";
import { getTenantSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEnabledSectionHrefs } from "@/lib/agency/sections";

export default async function OutreachLayout({ children }: { children: React.ReactNode }) {
  const session = await getTenantSession();
  // Middleware only checks "is there a valid JWT" (edge-safe, no Prisma) —
  // it cannot verify scope. A PLATFORM user's valid token passes middleware
  // but getTenantSession() correctly returns null here.
  if (!session) redirect("/outreach-login");
  const currentUser = { name: session.name, role: session.role?.name ?? "" };

  // Tenant-product lookup (cross-product guard) and section-flags lookup
  // both only need tenantId and don't depend on each other's result -- run
  // them together instead of two sequential round-trips. Each Supabase
  // round-trip costs real network latency now that this runs against
  // remote Postgres, and this layout re-runs on every Outreach page load.
  const [tenant, enabledSections] = await Promise.all([
    db.tenant.findUnique({
      where: { id: session.tenantId! },
      select: { product: { select: { slug: true } } },
    }),
    getEnabledSectionHrefs(session.tenantId!, "outreach"),
  ]);
  // Cross-product guard: a Marketing tenant's session is still TENANT-scoped
  // and would pass the proxy's scope check on /outreach/*, but their tenant
  // doesn't belong to the outreach product -- bounce them to their own
  // product's login instead of rendering Outreach's layout with no real
  // outreach data behind it.
  if (tenant?.product.slug !== "outreach") redirect("/outreach-login");

  return (
    <div className="relative min-h-screen">
      <OutreachSidebar currentUser={currentUser} enabledSections={enabledSections} />
      <AmbientWordmark word="OUTREACH" />
      <div className="relative z-10 flex min-h-screen flex-col md:ml-16">
        <OutreachMobileTopBar currentUser={currentUser} />
        <main className="flex-1 px-4 pb-20 pt-4 md:px-8 md:pb-8 md:pt-6">
          <PageTransition>{children}</PageTransition>
        </main>
        <OutreachMobileBottomBar enabledSections={enabledSections} />
      </div>
      <OutreachRealtimeToasts tenantId={session.tenantId!} />
    </div>
  );
}
