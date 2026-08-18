"use server";

import { db } from "@/lib/db";
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

  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== "PENDING") {
    return { ok: false as const, error: "Payment not found or already reviewed." };
  }

  const subscription = await db.subscription.findFirst({
    where: { tenantId: payment.tenantId },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();

  try {
    await db.$transaction([
      db.payment.update({
        where: { id: paymentId },
        data: { status: "SUCCEEDED", reviewedById: session.id, reviewedAt: now },
      }),
      db.tenant.update({ where: { id: payment.tenantId }, data: { status: "ACTIVE" } }),
      ...(subscription
        ? [
            db.subscription.update({
              where: { id: subscription.id },
              data: {
                status: "ACTIVE",
                currentPeriodStart: now,
                currentPeriodEnd: periodEndFor(subscription.billingCycle, now),
              },
            }),
          ]
        : []),
    ]);
  } catch (err) {
    await logError({
      source: "payment.review.approve",
      error: err,
      tenantId: payment.tenantId,
      context: { paymentId },
    });
    return { ok: false as const, error: "Failed to approve payment. Please try again." };
  }

  await db.auditLog.create({
    data: {
      actorId: session.id,
      action: "payment.approved",
      resource: "payment",
      tenantId: payment.tenantId,
      newValue: JSON.stringify({ paymentId, amountCents: payment.amountCents }),
      device: "Desktop",
      browser: "Admin Console",
    },
  });

  revalidatePath("/admin/payments");
  revalidatePath("/admin/tenants");
  return { ok: true as const };
}

export async function rejectPaymentAction(paymentId: string, reason?: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "billing", "edit");

  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== "PENDING") {
    return { ok: false as const, error: "Payment not found or already reviewed." };
  }

  await db.payment.update({
    where: { id: paymentId },
    data: { status: "FAILED", reviewedById: session.id, reviewedAt: new Date() },
  });

  await db.auditLog.create({
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

  revalidatePath("/admin/payments");
  return { ok: true as const };
}
