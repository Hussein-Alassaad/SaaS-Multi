"use server";

import { db, withPlatformAccess } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { logError } from "@/lib/error-log";

function periodEndFor(billingCycle: string, from: Date): Date {
  const end = new Date(from);
  if (billingCycle === "yearly") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

export async function approvePaymentAction(paymentId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "billing", "edit");

  // Admin billing review: platform-scoped, since it acts on any tenant's
  // payment. Payment and Subscription are both RLS tables.
  const { payment, subscription } = await withPlatformAccess(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status !== "PENDING") return { payment: null, subscription: null };
    const subscription = await tx.subscription.findFirst({
      where: { tenantId: payment.tenantId },
      orderBy: { createdAt: "desc" },
    });
    return { payment, subscription };
  });
  if (!payment) {
    return { ok: false as const, error: "Payment not found or already reviewed." };
  }
  const now = new Date();

  try {
    // Was a db.$transaction([...]) array -- sequential against one tx now,
    // still atomic (the conditional third write becomes a plain if).
    await withPlatformAccess(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: "SUCCEEDED", reviewedById: session.id, reviewedAt: now },
      });
      await tx.tenant.update({ where: { id: payment.tenantId }, data: { status: "ACTIVE" } });
      if (subscription) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "ACTIVE",
            currentPeriodStart: now,
            currentPeriodEnd: periodEndFor(subscription.billingCycle, now),
          },
        });
      }
    });
  } catch (err) {
    await logError({
      source: "payment.review.approve",
      error: err,
      tenantId: payment.tenantId,
      context: { paymentId },
    });
    return { ok: false as const, error: "Failed to approve payment. Please try again." };
  }

  await withPlatformAccess((tx) =>
    tx.auditLog.create({
      data: {
        actorId: session.id,
        action: "payment.approved",
        resource: "payment",
        tenantId: payment.tenantId,
        newValue: JSON.stringify({ paymentId, amountCents: payment.amountCents }),
        device: "Desktop",
        browser: "Admin Console",
      },
    })
  );

  revalidatePath("/admin/payments");
  revalidatePath("/admin/tenants");
  return { ok: true as const };
}

export async function rejectPaymentAction(paymentId: string, reason?: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "billing", "edit");

  const payment = await withPlatformAccess(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status !== "PENDING") return null;

    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "FAILED", reviewedById: session.id, reviewedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId: session.id,
        action: "payment.rejected",
        resource: "payment",
        tenantId: payment.tenantId,
        newValue: JSON.stringify({ paymentId, reason: reason ?? null }),
        device: "Desktop",
        browser: "Admin Console",
      },
    });
    return payment;
  });
  if (!payment) {
    return { ok: false as const, error: "Payment not found or already reviewed." };
  }

  revalidatePath("/admin/payments");
  return { ok: true as const };
}
