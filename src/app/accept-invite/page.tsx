import type { Metadata } from "next";
import { withPlatformAccess } from "@/lib/db";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { AcceptInviteForm } from "./AcceptInviteForm";

export const metadata: Metadata = {
  title: "Accept invite — Nexaris",
};

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ inviteId?: string }>;
}) {
  const { inviteId } = await searchParams;

  // Platform-scoped, same reasoning as acceptInviteAction: this page renders
  // pre-authentication, and the invite id (an unguessable cuid, which is the
  // accept-link token itself) is the only thing identifying which tenant the
  // invite belongs to. Read-only -- it just decides what to render.
  const invite = inviteId
    ? await withPlatformAccess((tx) =>
        tx.teamInvite.findUnique({
          where: { id: inviteId },
          include: { tenant: true, role: true },
        })
      )
    : null;

  const valid = invite?.status === "PENDING";

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
          <CardHeader className="mb-5 block">
            <CardTitle>{valid ? `Join ${invite!.tenant.companyName}` : "Invalid invite"}</CardTitle>
            <CardDescription>
              {valid
                ? `You've been invited as ${invite!.email}. Set your name and password to get started.`
                : "This invite link is invalid or has already been used."}
            </CardDescription>
          </CardHeader>

          {valid ? (
            <AcceptInviteForm inviteId={invite!.id} />
          ) : (
            <a
              href="/agency-login"
              className="block w-full rounded-lg bg-[var(--surface-2)] px-4 py-2 text-center text-sm text-[var(--accent-from)] hover:underline"
            >
              Go to sign in
            </a>
          )}
        </Card>
      </div>
    </div>
  );
}
