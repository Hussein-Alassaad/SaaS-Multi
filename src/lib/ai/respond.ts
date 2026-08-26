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

export type ReplyLanguage = "AR" | "AR_MA" | "EN";

export interface ConversationTurn {
  sender: "CUSTOMER" | "AI" | "HUMAN";
  body: string;
}

export interface AvailableMeetingSlot {
  id: string;
  /** ISO string -- kept as a plain string (not Date) since this crosses into the Claude prompt as text either way. */
  startsAt: string;
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
    `You are a professional sales & support agent responding on behalf of a business, replying in ${LANGUAGE_NAME[ctx.language]} to match how the customer is writing.`,
    `Tone: ${toneLine}`,
    `Never invent pricing, services, or policies -- only use what's in the knowledge base below.`,
    `You are having a real back-and-forth conversation, not answering each message in isolation -- remember what the customer already told you earlier in this thread and never ask for the same thing twice.`,
    `Your job is to collect enough information to hand this lead off well: their name, what they need/are interested in, and how to reach them. Ask ONE natural follow-up question at a time, the way a real person would -- never a list of questions in one message.`,
    `Once you have enough to make this a useful lead (you don't need everything, just enough to be useful), tell the customer to reach out on WhatsApp to continue -- naturally, as part of your reply, not as a canned line.`,
    ctx.availableSlots && ctx.availableSlots.length > 0
      ? `If the customer wants to book a meeting, you may propose ONE specific time from the real open slots listed below -- pick whichever best fits what they've said (e.g. "tomorrow afternoon" -> the soonest listed slot that afternoon). NEVER state it as confirmed: say something like "does <day/time> work for you? I'll get that confirmed by our team" -- the team still has to approve it before it's final, so never tell the customer it's booked.\n\n## Available meeting times (tenant's local time)\n${ctx.availableSlots.map((s) => `- ${s.startsAt}`).join("\n")}`
      : `If the customer wants to book a meeting, tell them you'll pass this to the team to arrange a time -- do not invent availability yourself (there are no open slots to offer right now).`,
    `\n## Knowledge Base\n${knowledgeBlock}`,
    ctx.settings.qualificationRules ? `\n## Qualification rules\n${ctx.settings.qualificationRules}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface ExtractedLeadInfo {
  name: string | null;
  needs: string | null;
  /** true once the AI judges it has collected enough to be a useful lead and has told the customer to continue on WhatsApp. */
  readyForHandoff: boolean;
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

const SENSITIVE_KEYWORDS_AR = ["سعر", "تكلفة", "دفع", "عقد", "اجتماع", "موعد"];
const SENSITIVE_KEYWORDS_EN = ["price", "cost", "payment", "contract", "meeting", "schedule"];

function buildExtractTool(availableSlots: AvailableMeetingSlot[]): Anthropic.Tool {
  return {
    name: "save_lead_info",
    description:
      "Records what's been learned about this customer/lead so far from the whole conversation, whether enough is known to hand off to the human team on WhatsApp, and which meeting slot (if any) your just-drafted reply proposed. Call this on every turn, even if nothing new was learned (repeat what's already known).",
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
          description: "True once enough is known to be a useful lead (roughly: what they want, and either a name or contact hint) AND your reply is telling them to continue on WhatsApp.",
        },
        proposedSlotId: {
          type: ["string", "null"],
          description:
            availableSlots.length > 0
              ? `The id of the meeting slot your reply just proposed to the customer, if any -- must be exactly one of: ${availableSlots.map((s) => s.id).join(", ")}. Null if your reply didn't propose a specific time.`
              : "Always null -- there are no available slots to propose right now.",
        },
      },
      required: ["name", "needs", "readyForHandoff", "proposedSlotId"],
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
  return { body, extracted: { name: ctx.clientName, needs: null, readyForHandoff: false, proposedSlotId: null } };
}

export async function generateAiReply(ctx: ConversationContext): Promise<AiReplyResult> {
  const latestMessage = ctx.history[ctx.history.length - 1]?.body ?? "";
  const isArabicFamily = ctx.language === "AR" || ctx.language === "AR_MA";
  const lowerMsg = latestMessage.toLowerCase();
  const touchesSensitive = isArabicFamily
    ? SENSITIVE_KEYWORDS_AR.some((k) => latestMessage.includes(k))
    : SENSITIVE_KEYWORDS_EN.some((k) => lowerMsg.includes(k));

  let body: string;
  let extracted: ExtractedLeadInfo;

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
          : { name: ctx.clientName, needs: null, readyForHandoff: false, proposedSlotId: null };
      } catch (err) {
        await logError({
          source: "ai.extract_lead_info",
          error: err,
          tenantId: ctx.tenantId,
          context: { conversationId: ctx.conversationId },
        });
        extracted = { name: ctx.clientName, needs: null, readyForHandoff: false, proposedSlotId: null };
      }
    } catch (err) {
      console.error("Claude API call failed, falling back to stub reply", err);
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

  return {
    body,
    language: ctx.language,
    requiresApproval: touchesSensitive || ctx.settings.approvalRequired,
    extracted,
  };
}

/**
 * Darija shares Arabic script with MSA and can't be told apart by script
 * alone -- it's distinguished by specific loanwords/particles MSA doesn't
 * use (French/Berber loanwords, distinctive function words). This is a
 * heuristic, not a real classifier: good enough to route obviously-Darija
 * messages to the Darija system prompt, not a guarantee on every message.
 */
const DARIJA_MARKERS = [
  "بزاف", "واخا", "دابا", "غادي", "زوين", "شحال", "فين", "كيفاش", "ديال", "باش", "هاد",
];

export function detectLanguage(text: string): ReplyLanguage {
  const arabicPattern = /[؀-ۿ]/;
  if (!arabicPattern.test(text)) return "EN";
  const hasDarijaMarker = DARIJA_MARKERS.some((marker) => text.includes(marker));
  return hasDarijaMarker ? "AR_MA" : "AR";
}
