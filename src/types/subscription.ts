import { z } from "zod";

export const SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
  "CANCELED",
  "EXPIRED",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const INVOICE_STATUSES = ["DRAFT", "OPEN", "PAID", "VOID", "UNCOLLECTIBLE"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_STATUSES = ["SUCCEEDED", "FAILED", "PENDING", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REFUND_STATUSES = ["PENDING", "APPROVED", "REJECTED", "COMPLETED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const planSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  maxUsers: z.number().int(),
  storageLimitMb: z.number().int(),
  aiCredits: z.number().int(),
  monthlyPrice: z.number().int(), // cents
  yearlyPrice: z.number().int(), // cents
  features: z.array(z.string()).default([]),
  isActive: z.boolean(),
});

export type PlanInput = z.infer<typeof planSchema>;
