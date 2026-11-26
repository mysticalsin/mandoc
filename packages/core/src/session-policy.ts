export const STAFF_IDLE_MS = 8 * 60 * 60 * 1000;
export const STAFF_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
export const VIEWER_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;

export function staffSessionExpiry(createdAt: number): number {
  return createdAt + STAFF_ABSOLUTE_MS;
}

export function staffSessionLive(session: { createdAt: number; lastSeenAt: number; expiresAt: number }, now: number): boolean {
  if (now >= session.expiresAt) return false;
  if (now - session.lastSeenAt >= STAFF_IDLE_MS) return false;
  if (now - session.createdAt >= STAFF_ABSOLUTE_MS) return false;
  return true;
}

export function viewerSessionExpiry(createdAt: number, shareExpiresAt: number): number {
  return Math.min(shareExpiresAt, createdAt + VIEWER_ABSOLUTE_MS);
}
