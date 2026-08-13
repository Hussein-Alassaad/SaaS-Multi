"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSessionToken, setSessionCookie, getTenantSession, hashPassword } from "@/lib/auth";
import { agencyRoleDbName } from "@/lib/agency-permissions";
import { rateLimit, getRequestIp } from "@/lib/rate-limit";
import { signupSchema, paymentProofSchema, type SignupInput } from "@/types/signup";
import { sendEmail } from "@/lib/email";
import { verificationEmail } from "@/lib/email-templates";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

export interface SignupState {
  error?: string;
  fieldErrors?: Partial<Record<keyof SignupInput, string>>;
}

const MARKETING_PRODUCT_SLUG = "marketing";

/**
 * Pure DB-writing core of signup, kept separate from the server action
 * wrapper so it's testable without a Next.js request context (the wrapper
 * calls next/headers's cookies()/redirect(), which need a real request).
 * Creates the Tenant (status TRIAL — no payment yet), the owner User, and a
 * TRIALING Subscription, all in one transaction. Throws on duplicate
 * subdomain/email (caught by the caller) rather than pre-checking, to avoid
 * a check-then-create race.
 */
export async function createTenantAndOwner(input: SignupInput) {
  const product = await db.product.findUnique({ where: { slug: MARKETING_PRODUCT_SLUG } });
  if (!product) throw new Error("Signup is not available right now. Please contact support.");

  const ownerRole = await db.role.findUnique({ where: { name: agencyRoleDbName("Owner") } });
  if (!ownerRole) throw new Error("Signup is not available right now. Please contact support.");

  const plan = await db.plan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.isActive) throw new Error("Selected plan is not available.");

  const [existingSubdomain, existingEmail] = await Promise.all([
    db.tenant.findUnique({ where: { subdomain: input.subdomain } }),
    db.user.findUnique({ where: { email: input.email } }),
  ]);
  if (existingSubdomain) throw new Error("That workspace URL is already taken.");
  if (existingEmail) throw new Error("An account with that email already exists.");

  const passwordHash = await hashPassword(input.password);
  const verificationToken = randomBytes(32).toString("hex");
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const result = await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        productId: product.id,
        companyName: input.companyName,
        subdomain: input.subdomain,
        status: "TRIAL",
      },
    });

    const owner = await tx.user.create({
      data: {
        email: input.email,
        name: input.ownerName,
        scope: "TENANT",
        status: "ACTIVE",
        roleId: ownerRole.id,
        tenantId: tenant.id,
        passwordHash,
        verificationToken,
        verificationExpiresAt,
      },
    });

    await tx.tenant.update({ where: { id: tenant.id }, data: { ownerId: owner.id } });

    await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: "TRIALING",
        billingCycle: input.billingCycle,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: owner.id,
        action: "tenant.signed_up",
        resource: "tenant",
        tenantId: tenant.id,
        newValue: JSON.stringify({ companyName: input.companyName, planId: plan.id }),
        device: "Desktop",
        browser: "Signup",
      },
    });

    return { tenant, owner, plan };
  });

  return result;
}

export async function signupAction(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const ip = await getRequestIp();
  const limit = rateLimit(`signup:${ip}`, 5, 60_000);
  if (!limit.ok) {
    return { error: "Too many signup attempts. Please try again in a minute." };
  }

  const raw = {
    companyName: String(formData.get("companyName") ?? "").trim(),
    subdomain: String(formData.get("subdomain") ?? "").trim().toLowerCase(),
    ownerName: String(formData.get("ownerName") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
    planId: String(formData.get("planId") ?? ""),
    billingCycle: String(formData.get("billingCycle") ?? "monthly"),
  };

  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: SignupState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof SignupInput;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Please fix the errors below.", fieldErrors };
  }

  let tenantId: string;
  let ownerId: string;
  let ownerEmail: string;
  let ownerRoleName: string;

  try {
    const { tenant, owner } = await createTenantAndOwner(parsed.data);
    tenantId = tenant.id;
    ownerId = owner.id;
    ownerEmail = owner.email;
    ownerRoleName = agencyRoleDbName("Owner");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Signup failed. Please try again." };
  }

  const token = await createSessionToken({ id: ownerId, role: ownerRoleName, scope: "TENANT" });
  await setSessionCookie(token);

  const user = await db.user.findUnique({ where: { id: ownerId } });
  if (user?.verificationToken) {
    const verifyUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/verify-email?token=${user.verificationToken}`;
    await sendEmail({ to: ownerEmail, ...verificationEmail(verifyUrl) });
  }

  void tenantId;
  redirect("/signup/success");
}

export async function submitPaymentProofAction(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const session = await getTenantSession();
  if (!session) return { error: "Not authenticated." };

  const parsed = paymentProofSchema.safeParse({
    proofReference: String(formData.get("proofReference") ?? "").trim(),
    proofNote: String(formData.get("proofNote") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid submission." };
  }

  const subscription = await db.subscription.findFirst({
    where: { tenantId: session.tenantId! },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });
  if (!subscription) return { error: "No active subscription found for this workspace." };

  const amountCents =
    subscription.billingCycle === "yearly" ? subscription.plan.yearlyPrice : subscription.plan.monthlyPrice;

  await db.payment.create({
    data: {
      tenantId: session.tenantId!,
      amountCents,
      status: "PENDING",
      method: "omt_wish",
      proofReference: parsed.data.proofReference,
      proofNote: parsed.data.proofNote,
    },
  });

  await db.auditLog.create({
    data: {
      actorId: session.id,
      action: "payment.proof_submitted",
      resource: "payment",
      tenantId: session.tenantId!,
      newValue: JSON.stringify({ proofReference: parsed.data.proofReference, amountCents }),
      device: "Desktop",
      browser: "Signup",
    },
  });

  revalidatePath("/signup/success");
  return {};
}
