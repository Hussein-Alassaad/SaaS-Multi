/**
 * AI response generation for Nexaris conversations. Calls the real Claude
 * API when ANTHROPIC_API_KEY is set; falls back to a deterministic stub
 * reply otherwise (dev/demo environments without a key still work end to
 * end -- approval queue, pipeline stage transitions, etc. all still exercise
 * real code paths, just with placeholder text instead of a live model).
 */

import type { AiSettings } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import { logError } from "@/lib/error-log";

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

interface ConversationContext {
  customerMessage: string;
  language: "AR" | "EN";
  clientName: string | null;
  knowledgeEntries: { title: string; body: string }[];
  settings: AiSettings;
  tenantId?: string;
  conversationId?: string;
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

function stubReply(ctx: ConversationContext): string {
  const isArabic = ctx.language === "AR";
  const greeting = ctx.clientName ? `أهلاً ${ctx.clientName}` : "أهلاً وسهلاً";
  return isArabic
    ? `${greeting}، شكراً لتواصلك معنا. [مسودة رد تجريبية -- سيتم استبدالها بردّ الذكاء الاصطناعي الفعلي بعد ربط مفتاح API]`
    : `Hello${ctx.clientName ? ` ${ctx.clientName}` : ""}, thanks for reaching out. [Draft placeholder reply -- will be replaced by a real AI response once the API key is connected]`;
}

export async function generateAiReply(ctx: ConversationContext): Promise<AiReplyResult> {
  const isArabic = ctx.language === "AR";
  const lowerMsg = ctx.customerMessage.toLowerCase();
  const touchesSensitive = isArabic
    ? SENSITIVE_KEYWORDS_AR.some((k) => ctx.customerMessage.includes(k))
    : SENSITIVE_KEYWORDS_EN.some((k) => lowerMsg.includes(k));

  let body: string;
  if (anthropic) {
    try {
      const response = await anthropic.messages.create({
        model: ctx.settings.model || "claude-sonnet-4-5",
        max_tokens: 512,
        system: buildSystemPrompt(ctx),
        messages: [{ role: "user", content: ctx.customerMessage }],
      });
      const textBlock = response.content.find((block) => block.type === "text");
      body = textBlock?.type === "text" ? textBlock.text : stubReply(ctx);
    } catch (err) {
      console.error("Claude API call failed, falling back to stub reply", err);
      await logError({
        source: "ai.generate_reply",
        error: err,
        tenantId: ctx.tenantId,
        context: { conversationId: ctx.conversationId, language: ctx.language, model: ctx.settings.model },
      });
      body = stubReply(ctx);
    }
  } else {
    body = stubReply(ctx);
  }

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
