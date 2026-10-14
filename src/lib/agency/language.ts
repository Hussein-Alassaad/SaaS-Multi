/**
 * Languages the agent talks in, and the small rules about them that both server and browser code need. No imports, so a
 * client component can use it.
 *
 * AR      Modern Standard Arabic, Arabic script
 * AR_MA   Moroccan Darija, Arabic script
 * AR_LB   Lebanese Arabic, Arabic script
 * ARABIZI Arabic written in Latin letters and numbers, Lebanese style ("kifak, shu bade")
 * ARABIZI_MA  Moroccan Darija in Latin letters and numbers ("salam, bghit n3rf chhal")
 * FR      French (widely used for business in Morocco)
 * EN      English
 */

export type ReplyLanguage = "AR" | "AR_MA" | "AR_LB" | "ARABIZI" | "ARABIZI_MA" | "FR" | "EN";

/** Written in Arabic script, so right-to-left. NOT `startsWith("AR")`: ARABIZI is Latin letters and reads left-to-right. */
export function isArabicScript(language: string | null | undefined): boolean {
  return language === "AR" || language === "AR_MA" || language === "AR_LB";
}

export type Dialect = "AUTO" | "MOROCCAN" | "LEBANESE";

/**
 * The workspace's dialect setting decides ambiguous Arabic: plain Arabic with no tell-tale words, or Latin-letter Arabic
 * with only words every dialect uses ("habibi", "shukran"). It never turns French or English into Arabic.
 */
export function applyDialect(language: ReplyLanguage, dialect: string | null | undefined): ReplyLanguage {
  if (dialect === "MOROCCAN") {
    if (language === "AR" || language === "AR_LB") return "AR_MA";
    if (language === "ARABIZI") return "ARABIZI_MA";
  } else if (dialect === "LEBANESE") {
    if (language === "AR" || language === "AR_MA") return "AR_LB";
    if (language === "ARABIZI_MA") return "ARABIZI";
  }
  return language;
}

/** What the customer is told when a meeting is confirmed. */
export function confirmationText(language: string, label: string): string {
  switch (language) {
    case "AR_MA":
      return `تم تأكيد المكالمة ديالك: ${label}. الفريق ديالنا غادي يتصل بيك على هاد النمرة.`;
    case "AR_LB":
    case "AR":
      return `تم تأكيد موعد المكالمة يوم ${label}. رح يتصل فيك فريقنا على هالرقم.`;
    case "ARABIZI_MA":
      return `L'appel dyalek tconfirma: ${label}. L'équipe dyalna ghadi tcalik 3la had numéro.`;
    case "ARABIZI":
      return `Mawed el mkelme mta2akkad: ${label}. Ra7 yettasel fik fari2na 3a hal ra2em.`;
    case "FR":
      return `Votre appel est confirmé pour ${label}. Notre équipe vous appellera sur ce numéro.`;
    default:
      return `Your call is confirmed for ${label}. Our team will phone you on this number.`;
  }
}

/** Sent about an hour before a confirmed call. */
export function reminderText(language: string, label: string): string {
  switch (language) {
    case "AR_MA":
      return `تذكير: الفريق ديالنا غادي يتصل بيك من هنا شي ساعة، ${label}.`;
    case "AR_LB":
    case "AR":
      return `تذكير: رح يتصل فيك فريقنا خلال حوالي ساعة، ${label}.`;
    case "ARABIZI_MA":
      return `Rappel: l'équipe dyalna ghadi tcalik mn hna chi sa3a, ${label}.`;
    case "ARABIZI":
      return `Tazkir: ra7 yettasel fik fari2na kharej nahw sa3a, ${label}.`;
    case "FR":
      return `Rappel : notre équipe vous appellera dans environ une heure, ${label}.`;
    default:
      return `Reminder: our team will phone you in about an hour, ${label}.`;
  }
}
