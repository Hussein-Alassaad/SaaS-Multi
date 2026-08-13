import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set new password — Nexaris",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let valid = false;
  let loginPath = "/login";

  if (token) {
    const user = await db.user.findUnique({ where: { resetToken: token } });
    if (user && user.resetTokenExpiresAt && user.resetTokenExpiresAt > new Date()) {
      valid = true;
      loginPath = user.scope === "TENANT" ? "/agency-login" : "/login";
    }
  }

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-gradient text-base font-bold text-white">
            N
          </div>
          <h1 className="mt-3 text-lg font-semibold text-gradient">Nexaris</h1>
          <p className="mt-1 text-xs text-[var(--text-4)]">Set a new password</p>
        </div>

        <Card padding="lg" hover={false}>
          <CardHeader className="mb-5 block">
            <CardTitle>New password</CardTitle>
            <CardDescription>
              {valid ? "Choose a new password for your account." : "This link is invalid or has expired."}
            </CardDescription>
          </CardHeader>

          {valid ? (
            <ResetPasswordForm token={token!} loginPath={loginPath} />
          ) : (
            <a
              href="/forgot-password"
              className="block w-full rounded-lg bg-[var(--surface-2)] px-4 py-2 text-center text-sm text-[var(--accent-from)] hover:underline"
            >
              Request a new link
            </a>
          )}
        </Card>
      </div>
    </div>
  );
}
