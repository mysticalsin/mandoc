const text = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("bad hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function timingSafeEqual(left: string, right: string): boolean {
  const a = text.encode(left);
  const b = text.encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function randomId(prefix: string): string {
  return `${prefix}_${bytesToBase64Url(randomBytes(16))}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", text.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacHex(value: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", text.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, text.encode(value));
  return bytesToHex(new Uint8Array(sig));
}

async function aesKey(material: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", text.encode(material));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Sealed copy of a share token so the creator can copy the link again. Lookup uses the hash, not this blob. */
export async function sealSecret(secret: string, keyMaterial: string): Promise<string> {
  const iv = randomBytes(12);
  const key = await aesKey(keyMaterial);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferSource(iv) }, key, text.encode(secret)));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return bytesToBase64Url(packed);
}

export async function openSecret(sealed: string, keyMaterial: string): Promise<string> {
  const packed = base64UrlToBytes(sealed);
  const iv = packed.slice(0, 12);
  const cipher = packed.slice(12);
  const key = await aesKey(keyMaterial);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bufferSource(iv) }, key, bufferSource(cipher));
  return new TextDecoder().decode(plain);
}
