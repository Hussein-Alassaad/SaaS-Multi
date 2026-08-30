import { redirect } from "next/navigation";
import { OutreachSidebar } from "@/components/layout/OutreachSidebar";
import { OutreachMobileTopBar } from "@/components/layout/OutreachMobileTopBar";
import { OutreachMobileBottomBar } from "@/components/layout/OutreachMobileBottomBar";
import { AmbientWordmark } from "@/components/layout/AmbientWordmark";
import { PageTransition } from "@/components/layout/PageTransition";
import { AnnouncementBanner } from "@/components/layout/AnnouncementBanner";
import { OutreachRealtimeToasts } from "@/components/outreach/OutreachRealtimeToasts";
import { getTenantSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEnabledSectionHrefs } from "@/lib/agency/sections";
import { getTenantNotifications } from "@/lib/notifications";
import { getUnhealthyAccountCount } from "@/lib/outreach/accounts";

export default async function OutreachLayout({ children }: { children: React.ReactNode }) {
  const session = await getTenantSession();
  // Middleware only checks "is there a valid JWT" (edge-safe, no Prisma) —
  // it cannot verify scope. A PLATFORM user's valid token passes middleware
  // but getTenantSession() correctly returns null here.
  if (!session) redirect("/outreach-login");
  const currentUser = { name: session.name, role: session.role?.name ?? "" };

  // This layout re-runs on every Outreach page load, so every extra
  // sequential round-trip here is latency every navigation pays. tenant
  // must be resolved first (its product.id feeds getTenantNotifications
  // below, and the cross-product guard needs it before rendering anything
  // real) -- but that's the ONLY genuine dependency: enabledSections,
  // unhealthyAccountCount, and notifications don't depend on each other,
  // so they run together instead of notifications waiting its own turn
  // after them (was 1 lookup -> Promise.all of 3 -> a 4th sequential
  // round-trip; now 1 lookup -> Promise.all of 3, one fewer full
  // round-trip per page).
  const tenant = await db.tenant.findUnique({
    where: { id: session.tenantId! },
    select: { product: { select: { id: true, slug: true } } },
  });
  // Cross-product guard: a Marketing tenant's session is still TENANT-scoped
  // and would pass the proxy's scope check on /outreach/*, but their tenant
  // doesn't belong to the outreach product -- bounce them to their own
  // product's login instead of rendering Outreach's layout with no real
  // outreach data behind it.
  if (tenant?.product.slug !== "outreach") redirect("/outreach-login");

  const [enabledSections, unhealthyAccountCount, announcements] = await Promise.all([
    getEnabledSectionHrefs(session.tenantId!, "outreach"),
    getUnhealthyAccountCount(session.tenantId!),
    getTenantNotifications(session.tenantId!, tenant.product.id),
  ]);

  return (
    <div className="relative min-h-screen">
      <OutreachSidebar
        currentUser={currentUser}
        enabledSections={enabledSections}
        unhealthyAccountCount={unhealthyAccountCount}
      />
      <AmbientWordmark word="OUTREACH" />
      <div className="relative z-10 flex min-h-screen flex-col md:ml-16">
        <OutreachMobileTopBar currentUser={currentUser} />
        <main className="flex-1 px-4 pb-20 pt-4 md:px-8 md:pb-8 md:pt-6">
          <AnnouncementBanner
            items={announcements.map((a) => ({
              id: a.id,
              title: a.title,
              body: a.body,
              imageUrl: a.imageUrl,
              sentAt: a.sentAt?.toISOString() ?? null,
            }))}
          />
          <PageTransition>{children}</PageTransition>
        </main>
        <OutreachMobileBottomBar enabledSections={enabledSections} unhealthyAccountCount={unhealthyAccountCount} />
      </div>
      <OutreachRealtimeToasts tenantId={session.tenantId!} />
    </div>
  );
}
