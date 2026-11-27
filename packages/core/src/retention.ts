/** Incomplete uploads are not a library. They are removed after a day. */
export const ABANDONED_UPLOAD_MS = 24 * 60 * 60 * 1000;
export const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;

export function ephemeralDue(expiresAt: number, now: number): boolean {
  return expiresAt <= now;
}

export function abandonedUpload(createdAt: number, status: string, now: number): boolean {
  return status === "uploading" && createdAt + ABANDONED_UPLOAD_MS <= now;
}

/**
 * `days === null` means Tony has not set a document retention period.
 * The job must not invent one. Soft-deleted documents are always eligible:
 * the delete already happened.
 */
export function documentDue(input: { createdAt: number; deletedAt: number | null; days: number | null; now: number }): boolean {
  if (input.deletedAt != null) return true;
  if (input.days == null) return false;
  if (!Number.isFinite(input.days) || input.days < 0) return false;
  return input.createdAt + input.days * 24 * 60 * 60 * 1000 <= input.now;
}
