import { hmacHex, randomBytes, timingSafeEqual } from "./crypto.js";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_EMAIL_LIMIT = 5;
export const OTP_WINDOW_MS = 15 * 60 * 1000;

/** Uniform 6-digit code. */
export function generateOtpCode(): string {
  const limit = 1_000_000;
  const max = Math.floor(0x1_0000_0000 / limit) * limit;
  let value = 0;
  do {
    const bytes = randomBytes(4);
    value = ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
    value >>>= 0;
  } while (value >= max);
  return String(value % limit).padStart(6, "0");
}

export async function hashOtp(code: string, pepper: string): Promise<string> {
  return hmacHex(code, pepper);
}

export function otpMatches(submittedHash: string, storedHash: string): boolean {
  return timingSafeEqual(submittedHash, storedHash);
}

export function otpStillValid(input: { expiresAt: number; attempts: number; now: number }): boolean {
  return input.expiresAt > input.now && input.attempts < OTP_MAX_ATTEMPTS;
}

export function rateAllows(count: number, limit: number): boolean {
  return count < limit;
}
