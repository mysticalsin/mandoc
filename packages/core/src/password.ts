import { bytesToBase64Url, base64UrlToBytes, randomBytes, timingSafeEqual } from "./crypto.js";

const ITERATIONS = 100_000;
export const PASSWORD_ATTEMPT_LIMIT = 5;
export const PASSWORD_WINDOW_MS = 15 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer, iterations: ITERATIONS },
    key,
    256,
  );
  return `pbkdf2$${ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const saltPart = parts[2];
  const hashPart = parts[3];
  if (!saltPart || !hashPart || !Number.isFinite(iterations) || iterations < 1) return false;
  const salt = base64UrlToBytes(saltPart);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer, iterations },
    key,
    256,
  );
  return timingSafeEqual(bytesToBase64Url(new Uint8Array(bits)), hashPart);
}

export function passwordPolicy(password: string): "ok" | "too_short" | "too_long" {
  if (password.length < 8) return "too_short";
  if (password.length > 200) return "too_long";
  return "ok";
}
