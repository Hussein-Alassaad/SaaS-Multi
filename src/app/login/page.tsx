import type { Metadata } from "next";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in — Admin Platform",
};

export default function LoginPage() {
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-gradient text-base font-bold text-white">
            A
          </div>
          <h1 className="mt-3 text-lg font-semibold text-gradient">Admin Platform</h1>
          <p className="mt-1 text-xs text-[var(--text-4)]">Sign in to the platform control center</p>
        </div>

        <Card padding="lg" hover={false}>
          <CardHeader className="mb-5 block">
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Platform staff login only.</CardDescription>
          </CardHeader>

          <LoginForm />
        </Card>

        <div className="mt-5 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]/60 px-4 py-3 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-5)]">
            Demo credentials
          </p>
          <p className="mt-1.5 text-xs text-[var(--text-4)]">
            Owner — <span className="text-[var(--text-3)]">ava.owner@platform.example.com</span> /{" "}
            <span className="text-[var(--text-3)]">owner123!</span>
          </p>
        </div>
      </div>
    </div>
  );
}
