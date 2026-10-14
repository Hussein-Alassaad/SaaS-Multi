import type { ReactNode } from "react";

/** Plain public page for legal text (privacy policy, data deletion). No login, no app chrome -- Meta's reviewers and customers open these. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="relative z-10 mx-auto w-full max-w-3xl px-5 py-12 text-[var(--text-2)]">
      <div className="mb-8">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-gradient text-sm font-bold text-white">N</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--text-1)]">{title}</h1>
        <p className="mt-1 text-xs text-[var(--text-4)]">Last updated {updated}</p>
      </div>
      <div className="space-y-6 text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--text-1)] [&_li]:mt-1 [&_ul]:list-disc [&_ul]:ps-5">
        {children}
      </div>
    </main>
  );
}

/** Who to write to. Set LEGAL_COMPANY_NAME and LEGAL_CONTACT_EMAIL on Vercel; until then the page says to use the platform. */
export function legalIdentity() {
  return {
    company: process.env.LEGAL_COMPANY_NAME || "Nexaris",
    email: process.env.LEGAL_CONTACT_EMAIL || null,
  };
}
