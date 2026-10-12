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
import { recordAiUsage } from "@/lib/ai/usage";

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

export type ReplyLanguage = "AR" | "AR_MA" | "AR_LB" | "ARABIZI" | "EN";

export interface ConversationTurn {
  sender: "CUSTOMER" | "AI" | "HUMAN";
  body: string;
}

export interface AvailableMeetingSlot {
  id: string;
  /** ISO string -- kept as a plain string (not Date) since this crosses into the Claude prompt as text either way. */
  startsAt: string;
  /** The time as the customer should read it, in the business's timezone and the customer's language, e.g. "Tuesday 14 October, 3:00 PM". */
  label: string;
}

interface ConversationContext {
  /** Full conversation so far, oldest first, ending with the newest customer message -- lets the AI hold context across turns instead of replying to each message in isolation. */
  history: ConversationTurn[];
  language: ReplyLanguage;
  clientName: string | null;
  knowledgeEntries: { title: string; body: string }[];
  settings: AiSettings;
  tenantId?: string;
  conversationId?: string;
  /** Real open MeetingSlot rows for this tenant, soonest first. Empty array (not undefined) when there are none -- the AI is told explicitly not to invent a time in that case, same rule as before this feature existed. */
  availableSlots?: AvailableMeetingSlot[];
}

const LANGUAGE_NAME: Record<ReplyLanguage, string> = {
  AR: "Modern Standard Arabic (فصحى)",
  AR_MA: "Moroccan Darija (الدارجة المغربية)",
  AR_LB: "Lebanese Arabic dialect (اللهجة اللبنانية), written in Arabic script",
  ARABIZI: "Lebanese Arabic written in Latin letters with numbers (Arabizi, e.g. 'kifak, shu bade'), exactly the way the customer is writing it",
  EN: "English",
};

export function buildSystemPrompt(ctx: ConversationContext): string {
  const toneLine =
    ctx.settings.tone === "FRIENDLY"
      ? "Warm and approachable, but still professional."
      : ctx.settings.tone === "FORMAL"
        ? "Highly formal and respectful, using a formal register."
        : "Professional, confident, and courteous.";

  const knowledgeBlock = ctx.knowledgeEntries.length
    ? ctx.knowledgeEntries.map((k) => `### ${k.title}\n${k.body}`).join("\n\n")
    : "(no knowledge base entries yet)";

  return [
    `You are a professional sales & support assistant answering customers' messages on behalf of a business, on a chat app (WhatsApp, Instagram or Facebook Messenger). You ONLY ever reply to messages that customers send you -- you never start a conversation or message anyone first. Reply in ${LANGUAGE_NAME[ctx.language]}, matching how the customer is writing.`,
    `Tone: ${toneLine}`,
    `Write the way a real person chats: short messages (usually 1-3 sentences), plain text, no markdown or bullet lists, at most one emoji and only when it fits.`,
    `Never invent pricing, services, opening hours, or policies -- only use what's in the knowledge base below. If the answer is not there, say you will check with the team (do not guess) and set needsHuman to true.`,
    `You are having a real back-and-forth conversation, not answering each message in isolation -- remember what the customer already told you earlier in this thread and never ask for the same thing twice.`,
    `Your goals, in order: (1) answer the customer's question helpfully from the knowledge base; (2) find out, naturally and ONE question at a time, what they need and their name; (3) when they show real interest (they ask about a service, a price, availability, or how to get started), offer them a meeting with the team.`,
    ctx.availableSlots && ctx.availableSlots.length > 0
      ? `To offer a meeting, propose ONE specific time from the real open slots listed below -- pick whichever best fits what they've said (e.g. "tomorrow afternoon" -> the soonest listed slot that afternoon). NEVER state it as confirmed: say something like "does <day/time> work for you? I'll get that confirmed by our team" -- the team still approves every meeting, so never tell the customer it's booked.\n\n## Available meeting times (already in the business's local time -- quote them exactly as written, never convert or reformat)\n${ctx.availableSlots.map((s) => `- ${s.label}`).join("\n")}`
      : `To offer a meeting when the customer is interested, tell them a team member will contact them to arrange a time -- do not invent availability yourself (there are no open slots to offer right now).`,
    `If the customer asks to speak to a person, is upset or complaining, asks for something you cannot answer from the knowledge base, or asks for something this business does not do, tell them a team member will take it from here and set needsHuman to true.`,
    `\n## Knowledge Base\n${knowledgeBlock}`,
    ctx.settings.qualificationRules ? `\n## Qualification rules\n${ctx.settings.qualificationRules}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface ExtractedLeadInfo {
  name: string | null;
  needs: string | null;
  /** true once the AI judges it has collected enough to be a useful lead to hand to the human team. */
  readyForHandoff: boolean;
  /** true when a person should take over: the customer asked for one, is upset, or asked something the knowledge base cannot answer. */
  needsHuman: boolean;
  /** Set only when the just-drafted reply proposed a specific meeting time to the customer -- the id of the MeetingSlot from ctx.availableSlots that was offered. Null otherwise. Creating the actual (still-pending-approval) MeetingRequest from this is the caller's job, not this module's -- see simulateInboundMessageAction. */
  proposedSlotId: string | null;
}

export interface AiReplyResult {
  body: string;
  language: ReplyLanguage;
  /** true if this reply touches pricing/commitment and should queue for human approval. */
  requiresApproval: boolean;
  extracted: ExtractedLeadInfo;
}

// Only money / commitment words force a human to approve a reply. "meeting" and "موعد" used to be here too, but offering a
// meeting is now the agent's main job -- the team still approves every MeetingRequest before it is final.
const SENSITIVE_KEYWORDS_AR = ["سعر", "تكلفة", "كلفة", "بكم", "دفع", "عقد", "خصم", "فاتورة"];
const SENSITIVE_KEYWORDS_EN = ["price", "cost", "payment", "contract", "discount", "invoice", "se3er", "s3er", "quote"];

function buildExtractTool(availableSlots: AvailableMeetingSlot[]): Anthropic.Tool {
  return {
    name: "save_lead_info",
    description:
      "Records what's been learned about this customer/lead so far from the whole conversation, whether enough is known to hand off to the human team, and which meeting slot (if any) your just-drafted reply proposed. Call this on every turn, even if nothing new was learned (repeat what's already known).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: ["string", "null"], description: "The customer's name, if they've given it. Null if unknown." },
        needs: {
          type: ["string", "null"],
          description: "A short summary (1-2 sentences) of what the customer needs or is interested in, based on the whole conversation so far. Null if not yet clear.",
        },
        readyForHandoff: {
          type: "boolean",
          description: "True once enough is known to be a useful lead for the human team (roughly: what they want, and either a name or contact hint).",
        },
        needsHuman: {
          type: "boolean",
          description: "True if a person should take over now: the customer asked for one, is upset or complaining, or asked something the knowledge base cannot answer.",
        },
        proposedSlotId: {
          type: ["string", "null"],
          description:
            availableSlots.length > 0
              ? `The id of the meeting slot your reply just proposed to the customer, if any -- must be exactly one of these ids (the time each id stands for is shown after it): ${availableSlots.map((s) => `${s.id} = ${s.label}`).join("; ")}. Null if your reply didn't propose a specific time.`
              : "Always null -- there are no available slots to propose right now.",
        },
      },
      required: ["name", "needs", "readyForHandoff", "needsHuman", "proposedSlotId"],
    },
  };
}

function stubReply(ctx: ConversationContext): { body: string; extracted: ExtractedLeadInfo } {
  const greeting =
    ctx.language === "EN"
      ? `Hello${ctx.clientName ? ` ${ctx.clientName}` : ""}, thanks for reaching out.`
      : ctx.clientName
        ? `أهلاً ${ctx.clientName}`
        : "أهلاً وسهلاً";
  const body =
    ctx.language === "EN"
      ? `${greeting} [Draft placeholder reply -- will be replaced by a real AI response once the API key is connected]`
      : `${greeting}، شكراً لتواصلك معنا. [مسودة رد تجريبية -- سيتم استبدالها بردّ الذكاء الاصطناعي الفعلي بعد ربط مفتاح API]`;
  return { body, extracted: { name: ctx.clientName, needs: null, readyForHandoff: false, needsHuman: false, proposedSlotId: null } };
}

export async function generateAiReply(ctx: ConversationContext): Promise<AiReplyResult> {
  const latestMessage = ctx.history[ctx.history.length - 1]?.body ?? "";
  const lowerMsg = latestMessage.toLowerCase();
  // Checked in both scripts regardless of the detected language: a Lebanese customer often mixes Arabic, Arabizi and English in one message.
  const touchesSensitive =
    SENSITIVE_KEYWORDS_AR.some((k) => latestMessage.includes(k)) || SENSITIVE_KEYWORDS_EN.some((k) => lowerMsg.includes(k));

  let body: string;
  let extracted: ExtractedLeadInfo;
  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let apiFailed = false;
  let apiErrorMessage: string | undefined;

  if (anthropic) {
    try {
      // Two calls, not one: a forced tool_choice response doesn't also
      // emit open-ended conversational text in the same turn, so the
      // reply is drafted first, then a second call (with that draft
      // appended to the conversation) extracts structured lead info from
      // the whole thread including this reply.
      const draft = await anthropic.messages.create({
        model: ctx.settings.model || "claude-sonnet-4-5",
        max_tokens: 512,
        system: buildSystemPrompt(ctx),
        messages: ctx.history.map((turn) => ({
          role: turn.sender === "CUSTOMER" ? ("user" as const) : ("assistant" as const),
          content: turn.body,
        })),
      });
      inputTokens += draft.usage?.input_tokens ?? 0;
      outputTokens += draft.usage?.output_tokens ?? 0;
      const textBlock = draft.content.find((block) => block.type === "text");
      body = textBlock?.type === "text" ? textBlock.text : stubReply(ctx).body;

      const availableSlots = ctx.availableSlots ?? [];
      try {
        const extraction = await anthropic.messages.create({
          model: ctx.settings.model || "claude-sonnet-4-5",
          max_tokens: 512,
          system:
            "You extract structured lead information from a sales conversation. Call save_lead_info based on everything said so far, including the agent's latest reply.",
          tools: [buildExtractTool(availableSlots)],
          tool_choice: { type: "tool", name: "save_lead_info" },
          messages: [
            ...ctx.history.map((turn) => ({
              role: turn.sender === "CUSTOMER" ? ("user" as const) : ("assistant" as const),
              content: turn.body,
            })),
            { role: "assistant" as const, content: body },
          ],
        });
        inputTokens += extraction.usage?.input_tokens ?? 0;
        outputTokens += extraction.usage?.output_tokens ?? 0;
        const toolUse = extraction.content.find((block) => block.type === "tool_use");
        const rawExtracted = toolUse?.type === "tool_use" ? (toolUse.input as ExtractedLeadInfo) : null;
        // Claude can still hallucinate an id outside the offered list despite
        // the tool schema's description -- tool schemas constrain shape, not
        // values, so this is validated the same way any other model output
        // touching a real DB write would be, rather than trusted blindly.
        const proposedSlotId =
          rawExtracted?.proposedSlotId && availableSlots.some((s) => s.id === rawExtracted.proposedSlotId)
            ? rawExtracted.proposedSlotId
            : null;
        extracted = rawExtracted
          ? { ...rawExtracted, proposedSlotId }
          : { name: ctx.clientName, needs: null, readyForHandoff: false, needsHuman: false, proposedSlotId: null };
      } catch (err) {
        await logError({
          source: "ai.extract_lead_info",
          error: err,
          tenantId: ctx.tenantId,
          context: { conversationId: ctx.conversationId },
        });
        extracted = { name: ctx.clientName, needs: null, readyForHandoff: false, needsHuman: false, proposedSlotId: null };
      }
    } catch (err) {
      console.error("Claude API call failed, falling back to stub reply", err);
      apiFailed = true;
      apiErrorMessage = err instanceof Error ? err.message : String(err);
      await logError({
        source: "ai.generate_reply",
        error: err,
        tenantId: ctx.tenantId,
        context: { conversationId: ctx.conversationId, language: ctx.language, model: ctx.settings.model },
      });
      const stub = stubReply(ctx);
      body = stub.body;
      extracted = stub.extracted;
    }
  } else {
    const stub = stubReply(ctx);
    body = stub.body;
    extracted = stub.extracted;
  }

  if (anthropic && ctx.tenantId) {
    await recordAiUsage({
      tenantId: ctx.tenantId,
      model: ctx.settings.model || "claude-sonnet-4-5",
      inputTokens,
      outputTokens,
      responseTimeMs: Date.now() - startedAt,
      success: !apiFailed,
      errorMessage: apiErrorMessage,
    });
  }

  return {
    body,
    language: ctx.language,
    // A canned stub (no API key, or Claude failed -- e.g. empty balance) must never go straight to a real customer.
    requiresApproval: touchesSensitive || ctx.settings.approvalRequired || !anthropic || apiFailed,
    extracted,
  };
}

/**
 * Darija / Lebanese / MSA share Arabic script and can't be told apart by
 * script alone -- they are distinguished by specific words the others don't
 * use. These are heuristics, not a real classifier: good enough to route
 * obviously-Moroccan or obviously-Lebanese messages to the right dialect
 * prompt, not a guarantee on every message.
 */
const DARIJA_MARKERS = [
  "بزاف", "واخا", "دابا", "غادي", "زوين", "شحال", "فين", "كيفاش", "ديال", "باش", "هاد",
];

const LEBANESE_MARKERS = [
  "شو", "كتير", "بدي", "بدنا", "هلق", "هلأ", "ليش", "وين", "عم ", "منيح", "كيفك", "كيفكن", "هيك", "دغري", "بكرا", "تكرم", "مرحبا", "اهلين", "أهلين", "ماشي", "لسا", "شي ",
];

// Arabic written in Latin letters: digits stand in for Arabic letters (3 = ع, 7 = ح, 2 = ء, 5 = خ, 9 = ص, 8 = غ) and some words are unmistakable.
const ARABIZI_WORDS = /\b(kifak|kifik|kifkon|shu|chou|bade|badi|badde|mnih|mneh|ktir|kteer|aywa|ayw[ae]h?|habibi|habibti|yalla|marhaba|ahla|ahlan|ya3ni|lesh|leh|wen|w[ei]n|hallaq|halla2|bokra|shokran|tekram|tfaddal|inshallah|mish|msh)\b/i;
const ARABIZI_DIGIT_WORD = /[a-z]+[235789][a-z]*|[a-z]*[235789][a-z]+/i;

export function detectLanguage(text: string): ReplyLanguage {
  const arabicPattern = /[\u0600-\u06FF]/;
  if (arabicPattern.test(text)) {
    if (DARIJA_MARKERS.some((marker) => text.includes(marker))) return "AR_MA";
    if (LEBANESE_MARKERS.some((marker) => text.includes(marker))) return "AR_LB";
    return "AR";
  }
  if (ARABIZI_WORDS.test(text) || (ARABIZI_DIGIT_WORD.test(text) && /\b(el|ya|ma|fi|3a|bi|la)\b/i.test(text))) return "ARABIZI";
  return "EN";
}
