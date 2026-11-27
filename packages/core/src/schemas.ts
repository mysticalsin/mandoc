import { z } from "zod";

const email = z.string().trim().toLowerCase().email().max(320);

export const emailSchema = email;

export const otpRequestSchema = z.object({ email });

export const otpVerifySchema = z.object({ email, code: z.string().regex(/^\d{6}$/) });

export const uploadCreateSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(200),
  byteSize: z.number().int().positive(),
});

export const shareCreateSchema = z.object({
  recipientEmails: z.array(email).min(1).max(50),
  expiresAt: z.number().int(),
  password: z.string().max(200).optional(),
  downloadAllowed: z.boolean(),
  watermarkEnabled: z.boolean(),
});

export const passwordSchema = z.object({ password: z.string().min(1).max(200) });

export const roleChangeSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  disabled: z.boolean().optional(),
});

export const retentionSchema = z.object({
  days: z.number().int().min(0).nullable(),
});

export const staffDomainsSchema = z.object({
  domains: z.array(z.string().max(253)).max(50).nullable(),
});

export const eventSchema = z.object({
  type: z.enum(["open", "page"]),
  page: z.number().int().positive().max(100_000).optional(),
});
