import { bytesToBase64Url, randomBytes, sha256Hex } from "./crypto.js";

/** Safety cap so a forgotten link cannot outlive a year. Not a retention period. */
export const MAX_SHARE_MS = 366 * 24 * 60 * 60 * 1000;
export const MIN_SHARE_MS = 5 * 60 * 1000;

export type ShareVisibility = "live" | "hidden";

export function newShareToken(): string {
  return bytesToBase64Url(randomBytes(16));
}

export async function shareTokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

export function shareVisibility(share: { revokedAt: number | null; expiresAt: number } | null, now: number): ShareVisibility {
  if (!share) return "hidden";
  if (share.revokedAt != null) return "hidden";
  if (share.expiresAt <= now) return "hidden";
  return "live";
}

export function expiryAllowed(expiresAt: number, now: number): boolean {
  const delta = expiresAt - now;
  return delta >= MIN_SHARE_MS && delta <= MAX_SHARE_MS;
}

export function hiddenBody(): { error: "not_found" } {
  return { error: "not_found" };
}
