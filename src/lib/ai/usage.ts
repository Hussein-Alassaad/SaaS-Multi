/**
 * AI usage logging and spend limits for the agency inbox agent.
 *
 * Why: AiUsageLog / AiBudget existed in the schema but the agency AI never
 * wrote to or read from them, so nothing recorded what the agent spent and
 * nothing could stop it. (On 2026-10-11 the Anthropic balance ran dry with no
 * warning on the outreach side -- the same blind spot.) Every Claude call made
 * for a customer reply is now logged, and checkAiBudget() lets the caller stop
 * generating replies, raise an alert and hand the chat to a human instead.
 */

import { db, withTenant } from "@/lib/db";
import { logError } from "@/lib/error-log";

// USD per million tokens. Approximate list prices; only used to estimate cost for budgets/dashboards.
const PRICING: { match: string; input: number; output: number }[] = [
  { match: "opus", input: 15, output: 75 },
  { match: "haiku", input: 1, output: 5 },
  { match: "sonnet", input: 3, output: 15 },
];

export function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING.find((p) => model.toLowerCase().includes(p.match)) ?? PRICING[PRICING.length - 1];
  const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.max(0, Math.ceil(usd * 100));
}

let marketingProductId: string | null | undefined;
async function getMarketingProductId(): Promise<string | null> {
  if (marketingProductId === undefined) {
    const product = await db.product.findUnique({ where: { slug: "marketing" }, select: { id: true } });
    marketingProductId = product?.id ?? null;
  }
  return marketingProductId;
}

export interface AiUsageRecord {
  tenantId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  responseTimeMs: number;
  success: boolean;
  errorMessage?: string;
}

/** Never throws: a logging failure must not break a customer reply. */
export async function recordAiUsage(r: AiUsageRecord): Promise<void> {
  try {
    const productId = await getMarketingProductId();
    if (!productId) return;
    await withTenant(r.tenantId, (tx) =>
      tx.aiUsageLog.create({
        data: {
          tenantId: r.tenantId,
          productId,
          model: r.model,
          tokens: r.inputTokens + r.outputTokens,
          costCents: estimateCostCents(r.model, r.inputTokens, r.outputTokens),
          responseTimeMs: r.responseTimeMs,
          success: r.success,
          errorMessage: r.errorMessage?.slice(0, 500),
        },
      })
    );
  } catch (err) {
    await logError({ source: "ai.usage_log", error: err, tenantId: r.tenantId });
  }
}

export type BudgetCheck = { allowed: true } | { allowed: false; reason: string };

/**
 * Applies the tenant's own AiBudget row if there is one, else the GLOBAL one,
 * else allows. A kill switch blocks outright; daily and monthly budgets (in
 * cents, 0 = no limit) block once the spend so far reaches them.
 */
export async function checkAiBudget(tenantId: string): Promise<BudgetCheck> {
  try {
    const budget =
      (await db.aiBudget.findFirst({ where: { scope: "TENANT", scopeId: tenantId } })) ??
      (await db.aiBudget.findFirst({ where: { scope: "GLOBAL" } }));
    if (!budget) return { allowed: true };
    if (budget.killSwitchEnabled) return { allowed: false, reason: "The AI kill switch is on." };

    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [day, month] = await withTenant(tenantId, async (tx) => [
      await tx.aiUsageLog.aggregate({ where: { tenantId, createdAt: { gte: dayStart } }, _sum: { costCents: true } }),
      await tx.aiUsageLog.aggregate({ where: { tenantId, createdAt: { gte: monthStart } }, _sum: { costCents: true } }),
    ]);
    if (budget.dailyBudgetCents > 0 && (day._sum.costCents ?? 0) >= budget.dailyBudgetCents) {
      return { allowed: false, reason: "The daily AI budget has been reached." };
    }
    if (budget.monthlyBudgetCents > 0 && (month._sum.costCents ?? 0) >= budget.monthlyBudgetCents) {
      return { allowed: false, reason: "The monthly AI budget has been reached." };
    }
    return { allowed: true };
  } catch (err) {
    // A broken budget lookup must not take customer replies down -- fail open, but leave a trail.
    await logError({ source: "ai.budget_check", error: err, tenantId });
    return { allowed: true };
  }
}
