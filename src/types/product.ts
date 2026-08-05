import { z } from "zod";

/**
 * Product is a registry entry — never a hardcoded enum of product names.
 * Admin code must treat every product generically via this shape.
 */
export const PRODUCT_STATUSES = ["ACTIVE", "INACTIVE", "MAINTENANCE", "FUTURE"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const productSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  status: z.enum(PRODUCT_STATUSES),
  version: z.string(),
  maintenanceMode: z.boolean(),
  config: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Product = z.infer<typeof productSchema>;

export interface ProductConfig {
  primaryColor?: string;
  icon?: string;
  supportEmail?: string;
  [key: string]: unknown;
}
