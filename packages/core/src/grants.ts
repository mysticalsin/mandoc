import { base64UrlToBytes, bytesToBase64Url, timingSafeEqual } from "./crypto.js";

export interface GrantClaims {
  v: 1;
  jti: string;
  shareId: string;
  documentId: string;
  versionId: string;
  sessionId: string;
  email: string;
  exp: number;
  watermark: boolean;
}

const text = new TextEncoder();

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", text.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function signGrant(claims: GrantClaims, secret: string): Promise<string> {
  const payload = bytesToBase64Url(text.encode(JSON.stringify(claims)));
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, text.encode(payload)));
  return `${payload}.${bytesToBase64Url(sig)}`;
}

export async function readGrant(token: string, secret: string, nowMs: number): Promise<GrantClaims | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig || token.slice(dot + 1).includes(".")) return null;
  const key = await importKey(secret);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, text.encode(payload)));
  if (!timingSafeEqual(bytesToBase64Url(expected), sig)) return null;
  let parsed: GrantClaims;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as GrantClaims;
  } catch {
    return null;
  }
  if (parsed.v !== 1 || typeof parsed.exp !== "number" || typeof parsed.jti !== "string") return null;
  if (parsed.exp * 1000 <= nowMs) return null;
  return parsed;
}

export function grantMatchesShare(
  claims: GrantClaims,
  share: { id: string; documentId: string; versionId: string; watermarkEnabled: boolean },
  session: { id: string; email: string },
): boolean {
  return (
    claims.shareId === share.id &&
    claims.documentId === share.documentId &&
    claims.versionId === share.versionId &&
    claims.sessionId === session.id &&
    claims.email === session.email &&
    claims.watermark === share.watermarkEnabled
  );
}
