import { z } from "zod";

export const SCOPE_TYPES = ["GLOBAL", "PRODUCT", "TENANT", "SUBSCRIPTION"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const AI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
] as const;
export type AiModel = (typeof AI_MODELS)[number];

export const aiBudgetSchema = z.object({
  id: z.string(),
  scope: z.enum(SCOPE_TYPES),
  scopeId: z.string().nullable().optional(),
  dailyBudgetCents: z.number().int().nonnegative(),
  monthlyBudgetCents: z.number().int().nonnegative(),
  rateLimitPerMin: z.number().int().positive(),
  defaultModel: z.string(),
  cachingEnabled: z.boolean(),
  killSwitchEnabled: z.boolean(),
});

export type AiBudgetInput = z.infer<typeof aiBudgetSchema>;
