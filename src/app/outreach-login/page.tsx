import type { Metadata } from "next";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { LoginForm } from "@/app/agency-login/LoginForm";

export const metadata: Metadata = {
  title: "Sign in — Outreach",
};

export default function OutreachLoginPage() {
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-gradient text-base font-bold text-white">
            O
          </div>
          <h1 className="mt-3 text-lg font-semibold text-gradient">Outreach</h1>
          <p className="mt-1 text-xs text-[var(--text-4)]">Sign in to your outreach workspace</p>
        </div>

        <Card padding="lg" hover={false}>
          <CardHeader className="mb-5 block">
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Outreach team members only.</CardDescription>
          </CardHeader>

          <LoginForm />
        </Card>
      </div>
    </div>
  );
}
