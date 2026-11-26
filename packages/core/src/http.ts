const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfAllows(input: {
  method: string;
  origin: string | null;
  appOrigin: string;
  requestHeader: string | null;
}): boolean {
  if (SAFE.has(input.method.toUpperCase())) return true;
  if (input.requestHeader !== "1") return false;
  if (!input.origin) return false;
  return input.origin === input.appOrigin;
}

export function securityHeaders(https: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join("; "),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cache-control": "no-store",
  };
  if (https) headers["strict-transport-security"] = "max-age=63072000; includeSubDomains";
  return headers;
}

export const STAFF_COOKIE = "__Host-mandoc_session";
export const VIEWER_COOKIE = "__Host-mandoc_viewer";
export const CSRF_HEADER = "X-Mandoc-Request";

export function cookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return rest.join("=") || null;
  }
  return null;
}

export function sessionCookie(name: string, token: string, maxAgeSeconds: number): string {
  const parts = [
    `${name}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join("; ");
}

export function clearCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
