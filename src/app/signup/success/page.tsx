import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth";
import { db, withTenant } from "@/lib/db";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PaymentProofForm } from "./PaymentProofForm";

export const metadata: Metadata = {
  title: "Complete payment — Nexaris",
};

export default async function SignupSuccessPage() {
  const session = await getTenantSession();
  if (!session) redirect("/agency-login");

  // Tenant is not an RLS table, so it stays on the plain client; Subscription
  // and Payment are, and share one tenant scope.
  const tenant = await db.tenant.findUnique({ where: { id: session.tenantId! } });
  const { subscription, latestPayment } = await withTenant(session.tenantId!, async (tx) => {
    const subscription = await tx.subscription.findFirst({
      where: { tenantId: session.tenantId! },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });
    const latestPayment = await tx.payment.findFirst({
      where: { tenantId: session.tenantId!, method: "omt_wish" },
      orderBy: { processedAt: "desc" },
    });
    return { subscription, latestPayment };
  });

  if (!subscription) redirect("/agency");

  const amountCents =
    subscription.billingCycle === "yearly" ? subscription.plan.yearlyPrice : subscription.plan.monthlyPrice;
  const amount = (amountCents / 100).toFixed(2);
  const referenceCode = `NX-${session.tenantId!.slice(-8).toUpperCase()}`;

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-gradient text-base font-bold text-white">
            N
          </div>
          <h1 className="mt-3 text-lg font-semibold text-gradient">Welcome to Nexaris</h1>
          <p className="mt-1 text-xs text-[var(--text-4)]">
            {tenant?.companyName} is set up. Complete payment to activate your workspace.
          </p>
        </div>

        <Card padding="lg" hover={false} className="mb-4">
          <CardHeader className="mb-4 block">
            <CardTitle>Pay via OMT / Wish</CardTitle>
            <CardDescription>
              {subscription.plan.name} plan — ${amount}/{subscription.billingCycle === "yearly" ? "year" : "month"}
            </CardDescription>
          </CardHeader>

          <div className="space-y-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-2)] p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-4)]">Send to (OMT/Wish)</span>
              <span className="font-medium text-[var(--text-1)]">+961 00 000 000</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-4)]">Amount</span>
              <span className="font-medium text-[var(--text-1)]">${amount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-4)]">Reference code</span>
              <span className="font-mono font-medium text-[var(--accent-from)]">{referenceCode}</span>
            </div>
          </div>

          <p className="mt-3 text-xs text-[var(--text-4)]">
            Include the reference code in your transfer note. After sending, submit the transaction reference below
            — our team will verify and activate your workspace, usually within a few hours.
          </p>
        </Card>

        <Card padding="lg" hover={false}>
          <CardHeader className="mb-4 block">
            <CardTitle>Submit payment proof</CardTitle>
            <CardDescription>
              {latestPayment
                ? "Your submission is being reviewed."
                : "Enter the transaction reference from your OMT/Wish receipt."}
            </CardDescription>
          </CardHeader>

          {latestPayment ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--border-hairline)] px-3 py-2.5 text-sm">
              <span className="font-mono text-[var(--text-2)]">{latestPayment.proofReference}</span>
              <Badge variant={latestPayment.status === "PENDING" ? "warm" : latestPayment.status === "SUCCEEDED" ? "success" : "hot"}>
                {latestPayment.status === "PENDING"
                  ? "Awaiting review"
                  : latestPayment.status === "SUCCEEDED"
                    ? "Approved"
                    : "Rejected — resubmit below"}
              </Badge>
            </div>
          ) : null}

          {(!latestPayment || latestPayment.status === "FAILED") && <PaymentProofForm />}
        </Card>

        <p className="mt-5 text-center text-xs text-[var(--text-4)]">
          You can also{" "}
          <a href="/agency" className="text-[var(--accent-from)] hover:underline">
            go to your dashboard
          </a>{" "}
          now and pay later.
        </p>
      </div>
    </div>
  );
}
