import type { Metadata } from "next";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset password — Nexaris",
};

export default function ForgotPasswordPage() {
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-gradient text-base font-bold text-white">
            N
          </div>
          <h1 className="mt-3 text-lg font-semibold text-gradient">Nexaris</h1>
          <p className="mt-1 text-xs text-[var(--text-4)]">Reset your password</p>
        </div>

        <Card padding="lg" hover={false}>
          <CardHeader className="mb-5 block">
            <CardTitle>Forgot password</CardTitle>
            <CardDescription>Enter your email and we&rsquo;ll send you a reset link.</CardDescription>
          </CardHeader>

          <ForgotPasswordForm />
        </Card>
      </div>
    </div>
  );
}
