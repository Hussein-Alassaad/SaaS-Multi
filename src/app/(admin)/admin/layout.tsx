import { Sidebar } from "@/components/layout/Sidebar";
import { MobileTopBar } from "@/components/layout/MobileTopBar";
import { MobileBottomBar } from "@/components/layout/MobileBottomSheet";
import { AmbientWordmark } from "@/components/layout/AmbientWordmark";
import { PageTransition } from "@/components/layout/PageTransition";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <Sidebar />
      <AmbientWordmark />
      <div className="relative z-10 flex min-h-screen flex-col md:ml-16">
        <MobileTopBar />
        <ImpersonationBanner />
        <main className="flex-1 px-4 pb-20 pt-4 md:px-8 md:pb-8 md:pt-6">
          <PageTransition>{children}</PageTransition>
        </main>
        <MobileBottomBar />
      </div>
    </div>
  );
}
