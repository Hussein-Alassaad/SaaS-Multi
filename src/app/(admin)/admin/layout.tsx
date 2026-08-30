import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileTopBar } from "@/components/layout/MobileTopBar";
import { MobileBottomBar } from "@/components/layout/MobileBottomSheet";
import { AmbientWordmark } from "@/components/layout/AmbientWordmark";
import { PageTransition } from "@/components/layout/PageTransition";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { ImpersonationProvider } from "@/lib/store/impersonation";
import { getSession } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // No middleware currently exists to gate /admin/* at the edge -- this
  // layout is the only thing standing between an invalid/missing/revoked
  // session and every /admin page's shell rendering (found and fixed
  // 2026-08-22 while testing real session revocation: a revoked session's
  // token was reaching this far and rendering the full layout, even though
  // every individual page's own data-fetching already correctly refused to
  // return real data for it via guard()). Same redirect-before-rendering
  // pattern src/app/(agency)/agency/layout.tsx already used correctly.
  if (!session || session.scope !== "PLATFORM") redirect("/login");

  const currentUser = { name: session.name, role: session.role?.name ?? "" };

  return (
    <ImpersonationProvider>
      <div className="relative min-h-screen">
        {/* Moved here from the root layout so each product's ambient glow
            can independently pick up a scoped theme override (see
            Outreach's own layout, which now has a blue/black accent) --
            Admin has no override, so this renders identically to before. */}
        <div className="ambient-glows" aria-hidden="true" />
        <Sidebar currentUser={currentUser} />
        <AmbientWordmark word="NEXARIS" />
        <div className="relative z-10 flex min-h-screen flex-col md:ml-16">
          <MobileTopBar />
          <ImpersonationBanner />
          <main className="flex-1 px-4 pb-20 pt-4 md:px-8 md:pb-8 md:pt-6">
            <PageTransition>{children}</PageTransition>
          </main>
          <MobileBottomBar />
        </div>
      </div>
    </ImpersonationProvider>
  );
}
