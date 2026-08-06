export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_ON_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_TYPES = ["BUG", "FEATURE_REQUEST", "FEEDBACK", "QUESTION", "BILLING"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const NOTIFICATION_AUDIENCES = [
  "ALL_TENANTS",
  "PRODUCT_TENANTS",
  "SPECIFIC_TENANT",
  "ALL_PLATFORM_USERS",
] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_STATUSES = ["DRAFT", "SCHEDULED", "SENT", "CANCELED"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const INTEGRATION_PROVIDERS = [
  "OPENAI",
  "CLAUDE",
  "GEMINI",
  "SMTP",
  "SUPABASE",
  "CLOUDFLARE",
  "STORAGE",
  "META",
  "WHATSAPP",
  "RESEND",
  "WEBHOOK",
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
