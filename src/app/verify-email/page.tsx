import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Verify email — Nexaris",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let status: "success" | "expired" | "invalid" = "invalid";
  let loginPath = "/login";

  if (token) {
    const user = await db.user.findUnique({ where: { verificationToken: token } });
    if (user) {
      loginPath = user.scope === "TENANT" ? "/agency-login" : "/login";
      if (user.verificationExpiresAt && user.verificationExpiresAt > new Date()) {
        await db.user.update({
          where: { id: user.id },
          data: { verifiedAt: new Date(), verificationToken: null, verificationExpiresAt: null },
        });
        status = "success";
      } else {
        status = "expired";
      }
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
        </div>

        <Card padding="lg" hover={false}>
          <CardHeader className="mb-4 block">
            <CardTitle>
              {status === "success" ? "Email verified" : status === "expired" ? "Link expired" : "Invalid link"}
            </CardTitle>
            <CardDescription>
              {status === "success"
                ? "Your email address has been confirmed."
                : status === "expired"
                  ? "This verification link has expired."
                  : "This verification link is invalid."}
            </CardDescription>
          </CardHeader>

          <a
            href={loginPath}
            className="block w-full rounded-lg bg-accent-gradient px-4 py-2 text-center text-sm font-medium text-white hover:brightness-110"
          >
            Go to sign in
          </a>
        </Card>
      </div>
    </div>
  );
}
