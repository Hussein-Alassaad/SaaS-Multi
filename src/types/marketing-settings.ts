import { z } from "zod";

// ---------------------------------------------------------------------------
// Company/Brand settings
// ---------------------------------------------------------------------------

export const companySettingsSchema = z.object({
  companyName: z.string().trim().max(200).optional().nullable(),
  logoUrl: z.string().trim().max(2000).optional().nullable(),
  website: z.string().trim().max(500).optional().nullable(),
  primaryColor: z.string().trim().max(20).optional().nullable(),
  secondaryColor: z.string().trim().max(20).optional().nullable(),
  fontFamily: z.string().trim().max(100).optional().nullable(),
  senderName: z.string().trim().max(200).optional().nullable(),
  emailSignature: z.string().trim().max(5000).optional().nullable(),
  voiceTone: z.string().trim().max(2000).optional().nullable(),
});

export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;

// ---------------------------------------------------------------------------
// Localization settings
// ---------------------------------------------------------------------------

export const LOCALIZATION_LANGUAGES = ["en", "ar", "fr", "es"] as const;
export type LocalizationLanguage = (typeof LOCALIZATION_LANGUAGES)[number];

export const localizationSettingsSchema = z.object({
  defaultLanguage: z.enum(LOCALIZATION_LANGUAGES).default("en"),
  timezone: z.string().trim().min(1).max(100),
  dateFormat: z.string().trim().min(1).max(20),
  numberFormat: z.string().trim().min(1).max(20),
});

export type LocalizationSettingsInput = z.infer<typeof localizationSettingsSchema>;

// ---------------------------------------------------------------------------
// SMTP settings
// ---------------------------------------------------------------------------

export const smtpConfigSchema = z.object({
  host: z.string().trim().min(1, "Host is required.").max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1, "Username is required.").max(255),
  password: z.string().min(1, "Password is required.").max(500),
  useTls: z.boolean(),
  fromEmail: z.string().trim().email("Enter a valid from-email address."),
  fromName: z.string().trim().max(200).optional().nullable(),
});

export type SmtpConfigInput = z.infer<typeof smtpConfigSchema>;
