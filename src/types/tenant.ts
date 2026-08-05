import { z } from "zod";

export const TENANT_STATUSES = ["ACTIVE", "TRIAL", "PAST_DUE", "SUSPENDED", "CHURNED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const USER_SCOPES = ["PLATFORM", "TENANT"] as const;
export type UserScope = (typeof USER_SCOPES)[number];

export const USER_STATUSES = ["ACTIVE", "INVITED", "SUSPENDED", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const tenantSchema = z.object({
  id: z.string(),
  productId: z.string(),
  companyName: z.string().min(1),
  subdomain: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
  status: z.enum(TENANT_STATUSES),
  ownerId: z.string().nullable().optional(),
  storageUsedMb: z.number().int().nonnegative(),
  aiCreditsUsed: z.number().int().nonnegative(),
});

export type TenantInput = z.infer<typeof tenantSchema>;

export const STATUS_TEMPERATURE: Record<TenantStatus, "hot" | "warm" | "cold"> = {
  ACTIVE: "cold", // healthy / cool
  TRIAL: "warm",
  PAST_DUE: "hot",
  SUSPENDED: "hot",
  CHURNED: "hot",
};
