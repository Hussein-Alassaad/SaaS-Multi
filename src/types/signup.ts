import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200);

export const signupSchema = z.object({
  companyName: z.string().min(1).max(120),
  subdomain: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
  ownerName: z.string().min(1).max(120),
  email: z.string().email(),
  password: passwordSchema,
  planId: z.string().min(1, "Select a plan"),
  billingCycle: z.enum(["monthly", "yearly"]),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const paymentProofSchema = z.object({
  proofReference: z.string().min(3, "Enter the transaction reference").max(120),
  proofNote: z.string().max(500).optional(),
});

export type PaymentProofInput = z.infer<typeof paymentProofSchema>;
