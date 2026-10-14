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

import type { ReplyLanguage } from "@/lib/agency/language";
export type { ReplyLanguage };

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
  /** The customer's phone number if we already have it (always true on WhatsApp, never on Instagram/Facebook until they give it). */
  clientPhone?: string | null;
  knowledgeEntries: { title: string; body: string }[];
  settings: AiSettings;
  tenantId?: string;
  conversationId?: string;
  /** Real open MeetingSlot rows for this tenant, soonest first. Empty array (not undefined) when there are none -- the AI is told explicitly not to invent a time in that case, same rule as before this feature existed. */
  availableSlots?: AvailableMeetingSlot[];
}

const LANGUAGE_NAME: Record<ReplyLanguage, string> = {
  AR: "Modern Standard Arabic (فصحى)",
  AR_MA: "Moroccan Darija (الدارجة المغربية), written in Arabic script, mixing in French words where Moroccans naturally do",
  ARABIZI_MA: "Moroccan Darija written in Latin letters with numbers (e.g. 'salam, bghit n3rf chhal'), mixing in French words the way Moroccans do, exactly the way the customer is writing it",
  FR: "French (français), natural and polite, the way a Moroccan business writes to its customers",
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
    `You are an automated assistant. Do not bring this up yourself, but if the customer asks whether they are talking to a person or a bot, answer honestly that you are the business's automated assistant and that a team member can take over at any time. Never claim to be a human.`,
    `Your goals, in order: (1) answer the customer's question helpfully from the knowledge base; (2) find out, naturally and ONE question at a time, what they need and their name; (3) when they show real interest (they ask about a service, a price, availability, or how to get started), offer them a meeting with the team.`,
    ctx.availableSlots && ctx.availableSlots.length > 0
      ? `To offer a meeting, propose ONE specific time from the real open slots listed below -- pick whichever best fits what they've said (e.g. "tomorrow afternoon" -> the soonest listed slot that afternoon). NEVER state it as confirmed: say something like "does <day/time> work for you? I'll get that confirmed by our team" -- the team still approves every meeting, so never tell the customer it's booked.\n\n## Available meeting times (already in the business's local time -- quote them exactly as written, never convert or reformat)\n${ctx.availableSlots.map((s) => `- ${s.label}`).join("\n")}`
      : `To offer a meeting when the customer is interested, tell them a team member will contact them to arrange a time -- do not invent availability yourself (there are no open slots to offer right now).`,
    `The meeting is a PHONE CALL: a team member calls the customer at the agreed time. ${
      ctx.clientPhone
        ? "We already have the customer's phone number, so do not ask for it; just say the team will call them."
        : "We do NOT have the customer's phone number yet. When you offer a time, also ask which number the team should call (one question, in the same message), and set phone when they give it."
    }`,
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
  /** The phone number the customer gave for the call, exactly as written, or null if they have not given one. */
  phone: string | null;
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
const SENSITIVE_KEYWORDS_AR = ["سعر", "تكلفة", "كلفة", "بكم", "دفع", "عقد", "خصم", "فاتورة", "ثمن", "تمن", "بشحال", "شحال", "تخفيض"];
// Latin script: English, Lebanese/Moroccan Arabizi and French money words ("chhal" = how much, "taman" = price in Darija).
const SENSITIVE_KEYWORDS_EN = [
  "price", "cost", "payment", "contract", "discount", "invoice", "se3er", "s3er", "quote",
  "chhal", "ch7al", "shhal", "taman", "prix", "tarif", "devis", "combien", "facture", "paiement", "remise", "réduction", "reduction",
];

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
        phone: {
          type: ["string", "null"],
          description: "A phone number the customer gave for the team to call them on, exactly as they wrote it. Null if they have not given one in this conversation.",
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
      required: ["name", "needs", "readyForHandoff", "needsHuman", "phone", "proposedSlotId"],
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
  return { body, extracted: { name: ctx.clientName, needs: null, readyForHandoff: false, needsHuman: false, phone: null, proposedSlotId: null } };
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
          : { name: ctx.clientName, needs: null, readyForHandoff: false, needsHuman: false, phone: null, proposedSlotId: null };
      } catch (err) {
        await logError({
          source: "ai.extract_lead_info",
          error: err,
          tenantId: ctx.tenantId,
          context: { conversationId: ctx.conversationId },
        });
        extracted = { name: ctx.clientName, needs: null, readyForHandoff: false, needsHuman: false, phone: null, proposedSlotId: null };
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
  "بغيت", "بغينا", "علاش", "مزيان", "لاباس", "عافاك", "عفاك", "كاين", "كاينة", "فاش", "دياله", "ديالي", "ديالك", "شنو", "مشكل", "نمرة", "خويا", "ماكاينش", "بشحال", "حيت",
];

// Only words that are Lebanese-specific. Generic ones ("مرحبا", "ماشي", "وين", "اهلين") are used all over the Arab world, and the
// first client is Moroccan, so they no longer decide the dialect on their own.
const LEBANESE_MARKERS = [
  "شو", "كتير", "بدي", "بدنا", "هلق", "هلأ", "ليش", "منيح", "كيفك", "كيفكن", "هيك", "دغري", "بكرا", "لسا",
];

// Arabic written in Latin letters: digits stand in for Arabic letters (3 = ع, 7 = ح, 2 = ء, 5 = خ, 9 = ص, 8 = غ) and some words are unmistakable.
const ARABIZI_WORDS = /\b(salam|slm|kifak|kifik|kifkon|shu|chou|bade|badi|badde|mnih|mneh|ktir|kteer|aywa|ayw[ae]h?|habibi|habibti|yalla|marhaba|ahla|ahlan|ya3ni|lesh|leh|wen|w[ei]n|hallaq|halla2|bokra|shokran|tekram|tfaddal|inshallah|mish|msh)\b/i;
const ARABIZI_DIGIT_WORD = /[a-z]+[235789][a-z]*|[a-z]*[235789][a-z]+/i;

// Moroccan Darija in Latin letters: words Lebanese Arabizi does not use.
const DARIJA_LATIN_WORDS = /\b(salam|slm|bghit|bghina|bghiti|chhal|ch7al|shhal|bch7al|wakha|wach|mzyan|mezyan|labas|lbas|kifach|kifash|daba|3afak|afak|bzaf|bzzaf|khoya|hadchi|dyal|dyali|dyalk|ghadi|kayn|kayna|kaynin|mabghitch|fayn|sa7a|ana|nta|nti|taman|hna|hnaya|mrehba|merhba)\b/i;
// Words that make a Latin-script message Darija rather than just "some Arabizi": ones Lebanese Arabizi would not use.
const DARIJA_LATIN_STRONG = /\b(bghit|bghina|bghiti|chhal|ch7al|shhal|bch7al|wakha|wach|mzyan|mezyan|labas|lbas|kifach|kifash|daba|3afak|bzaf|bzzaf|khoya|hadchi|dyal|dyali|dyalk|ghadi|kayn|kayna|kaynin|mabghitch|fayn|taman)\b/i;

// French is widely used for business in Morocco. Only words that are not also English.
const FRENCH_WORDS = /\b(bonjour|bonsoir|salut|merci|svp|s'il vous pla[i\u00EE]t|s'il te pla[i\u00EE]t|je voudrais|je veux|je cherche|j'aimerais|combien|prix|tarifs?|devis|rendez-vous|disponible|horaires?|besoin|vous|votre|vos|avez|pouvez|pourriez|est-ce que|oui|aujourd'hui|demain|ce soir)\b/i;

export function detectLanguage(text: string): ReplyLanguage {
  const arabicPattern = /[\u0600-\u06FF]/;
  if (arabicPattern.test(text)) {
    if (DARIJA_MARKERS.some((marker) => text.includes(marker))) return "AR_MA";
    if (LEBANESE_MARKERS.some((marker) => text.includes(marker))) return "AR_LB";
    return "AR";
  }
  // Latin script, most specific first: Moroccan Darija ("salam bghit rendez-vous" is Darija, even with a French word in it),
  // then Lebanese-style Arabizi, then French, then English.
  if (DARIJA_LATIN_STRONG.test(text) || (/\bsalam\b/i.test(text) && DARIJA_LATIN_WORDS.test(text.replace(/\bsalam\b/i, "")))) return "ARABIZI_MA";
  if (ARABIZI_WORDS.test(text) || (ARABIZI_DIGIT_WORD.test(text) && /\b(el|ya|ma|fi|3a|bi|la)\b/i.test(text))) return "ARABIZI";
  if (FRENCH_WORDS.test(text) || (/[\u00E9\u00E8\u00EA\u00E0\u00E7\u00F9\u00E2\u00EE\u00F4\u00FB]/i.test(text) && /\b(je|le|la|les|un|une|pour|est|et|de|des|du)\b/i.test(text))) return "FR";
  return "EN";
}
