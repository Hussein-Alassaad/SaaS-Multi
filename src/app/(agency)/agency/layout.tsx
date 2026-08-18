import { redirect } from "next/navigation";
import { AgencySidebar } from "@/components/layout/AgencySidebar";
import { AgencyMobileTopBar } from "@/components/layout/AgencyMobileTopBar";
import { AgencyMobileBottomBar } from "@/components/layout/AgencyMobileBottomBar";
import { AmbientWordmark } from "@/components/layout/AmbientWordmark";
import { PageTransition } from "@/components/layout/PageTransition";
import { getTenantSession } from "@/lib/auth";
import { isRtl, type UiLanguage } from "@/lib/i18n";
import { db } from "@/lib/db";
import { getEnabledSectionHrefs } from "@/lib/agency/sections";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const session = await getTenantSession();
  // Middleware only checks "is there a valid JWT" (edge-safe, no Prisma) —
  // it cannot verify scope. A PLATFORM user's valid token passes middleware
  // but getTenantSession() correctly returns null here; every /agency page
  // assumes a real tenant session, so redirect before rendering any of them.
  if (!session) redirect("/agency-login");
  const currentUser = { name: session.name, role: session.role?.name ?? "" };
  const lang = (session.uiLanguage as UiLanguage) ?? "EN";
  const rtl = isRtl(lang);

  const tenant = await db.tenant.findUnique({
    where: { id: session.tenantId! },
    select: { product: { select: { slug: true } } },
  });
  const enabledSections = await getEnabledSectionHrefs(session.tenantId!, tenant?.product.slug ?? "marketing");

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="relative min-h-screen">
      <AgencySidebar currentUser={currentUser} lang={lang} enabledSections={enabledSections} />
      <AmbientWordmark word="AGENCY" />
      <div className={`relative z-10 flex min-h-screen flex-col ${rtl ? "md:mr-16" : "md:ml-16"}`}>
        <AgencyMobileTopBar currentUser={currentUser} lang={lang} />
        <main className="flex-1 px-4 pb-20 pt-4 md:px-8 md:pb-8 md:pt-6">
          <PageTransition>{children}</PageTransition>
        </main>
        <AgencyMobileBottomBar lang={lang} enabledSections={enabledSections} />
      </div>
    </div>
  );
}
