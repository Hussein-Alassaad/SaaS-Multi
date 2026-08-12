/**
 * AI response generation for Nexaris conversations.
 *
 * TODO(claude-api-key): This is a deterministic stub, not a real model call.
 * Once an Anthropic API key is available (console.anthropic.com), replace
 * generateAiReply()'s body with a real `@anthropic-ai/sdk` call:
 *   - model: tenant's AiSettings.model (defaults to "claude-sonnet-4-5")
 *   - system prompt: buildSystemPrompt() below already assembles tone,
 *     language, qualification rules, and Knowledge Base entries -- reuse it
 *     as the `system` param.
 *   - conversation history: pass prior Messages in the conversation as the
 *     `messages` array (map sender CUSTOMER->user, AI->assistant; drop HUMAN
 *     sender or fold it in as assistant too since it's a human-sent reply).
 * Until then, callers get a canned Arabic-first acknowledgement so the rest
 * of the pipeline (approval queue, pipeline stage transitions, meeting
 * offers) can be built and tested end-to-end without a live model.
 */

import type { AiSettings } from "@prisma/client";

interface ConversationContext {
  customerMessage: string;
  language: "AR" | "EN";
  clientName: string | null;
  knowledgeEntries: { title: string; body: string }[];
  settings: AiSettings;
}

export function buildSystemPrompt(ctx: ConversationContext): string {
  const toneLine =
    ctx.settings.tone === "FRIENDLY"
      ? "Warm and approachable, but still professional."
      : ctx.settings.tone === "FORMAL"
        ? "Highly formal and respectful, using formal Arabic register."
        : "Professional, confident, and courteous.";

  const knowledgeBlock = ctx.knowledgeEntries.length
    ? ctx.knowledgeEntries.map((k) => `### ${k.title}\n${k.body}`).join("\n\n")
    : "(no knowledge base entries yet)";

  return [
    `You are a professional sales & support agent responding on behalf of a business, primarily in Modern Standard Arabic (فصحى), with English fallback if the customer writes in English.`,
    `Tone: ${toneLine}`,
    `Never invent pricing, services, or policies -- only use what's in the knowledge base below.`,
    `Collect the customer's name, contact info, and needs naturally over the conversation, don't interrogate them in one message.`,
    `If the customer wants to talk to a human or book a meeting, offer to check available times.`,
    `\n## Knowledge Base\n${knowledgeBlock}`,
    ctx.settings.qualificationRules
      ? `\n## Qualification rules\n${ctx.settings.qualificationRules}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface AiReplyResult {
  body: string;
  language: "AR" | "EN";
  /** true if this reply touches pricing/commitment and should queue for human approval. */
  requiresApproval: boolean;
}

const SENSITIVE_KEYWORDS_AR = ["سعر", "تكلفة", "دفع", "عقد", "اجتماع", "موعد"];
const SENSITIVE_KEYWORDS_EN = ["price", "cost", "payment", "contract", "meeting", "schedule"];

/**
 * TODO(claude-api-key): swap this stub for a real Claude call. Signature is
 * already async so callers won't need to change when it's wired up.
 */
export async function generateAiReply(ctx: ConversationContext): Promise<AiReplyResult> {
  const isArabic = ctx.language === "AR";
  const lowerMsg = ctx.customerMessage.toLowerCase();
  const touchesSensitive = isArabic
    ? SENSITIVE_KEYWORDS_AR.some((k) => ctx.customerMessage.includes(k))
    : SENSITIVE_KEYWORDS_EN.some((k) => lowerMsg.includes(k));

  const greeting = ctx.clientName ? `أهلاً ${ctx.clientName}` : "أهلاً وسهلاً";
  const body = isArabic
    ? `${greeting}، شكراً لتواصلك معنا. [مسودة رد تجريبية -- سيتم استبدالها بردّ الذكاء الاصطناعي الفعلي بعد ربط مفتاح API]`
    : `Hello${ctx.clientName ? ` ${ctx.clientName}` : ""}, thanks for reaching out. [Draft placeholder reply -- will be replaced by a real AI response once the API key is connected]`;

  return {
    body,
    language: ctx.language,
    requiresApproval: touchesSensitive || ctx.settings.approvalRequired,
  };
}

export function detectLanguage(text: string): "AR" | "EN" {
  const arabicPattern = /[؀-ۿ]/;
  return arabicPattern.test(text) ? "AR" : "EN";
}
