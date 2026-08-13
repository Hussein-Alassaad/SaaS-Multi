import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = {
  title: "Sign up — Nexaris",
};

export default async function SignupPage() {
  const plans = await db.plan.findMany({
    where: { isActive: true },
    orderBy: { monthlyPrice: "asc" },
  });

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-gradient text-base font-bold text-white">
            N
          </div>
          <h1 className="mt-3 text-lg font-semibold text-gradient">Nexaris</h1>
          <p className="mt-1 text-xs text-[var(--text-4)]">Create your agency workspace</p>
        </div>

        <Card padding="lg" hover={false}>
          <CardHeader className="mb-5 block">
            <CardTitle>Get started</CardTitle>
            <CardDescription>14-day trial, no card required.</CardDescription>
          </CardHeader>

          <SignupForm
            plans={plans.map((p) => ({
              id: p.id,
              name: p.name,
              slug: p.slug,
              monthlyPrice: p.monthlyPrice,
              yearlyPrice: p.yearlyPrice,
            }))}
          />
        </Card>

        <p className="mt-5 text-center text-xs text-[var(--text-4)]">
          Already have an account?{" "}
          <a href="/agency-login" className="text-[var(--accent-from)] hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
