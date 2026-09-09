import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { getActiveImpersonation } from "@/lib/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nexaris",
  description: "Multi-tenant SaaS admin control center",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Fetched once per request, here rather than lower in the tree, so the
  // banner (and the fact that it reflects REAL server-verified state, not
  // client React state -- see ImpersonationBanner's own docstring) covers
  // every route, admin and tenant/outreach pages alike, without every
  // section's own layout needing to remember to fetch and render it.
  const activeImpersonation = await getActiveImpersonation();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col relative">
        <ThemeProvider>
          <ToastProvider>
            <ImpersonationBanner active={activeImpersonation} />
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
