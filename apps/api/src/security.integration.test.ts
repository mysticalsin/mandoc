import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { CSRF_HEADER, STAFF_COOKIE, VIEWER_COOKIE, cookieValue, shareTokenHash } from "@mandoc/core";
import { MemoryStorage } from "@mandoc/cf";
import { createDb, findShareByHash, setDocumentRetentionDays, type Db } from "@mandoc/db";
import { openTestDatabase } from "../../../packages/db/src/node-d1.ts";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { runRetention } from "./retention-job.js";

const origin = "http://127.0.0.1:8791";

function testDb(): Db {
  const sql = readFileSync(fileURLToPath(new URL("../../../packages/db/migrations/0001_init.sql", import.meta.url)), "utf8");
  return createDb(openTestDatabase(sql) as D1Database);
}

const config: AppConfig = {
  environment: "development",
  appOrigin: origin,
  mailer: "dev-outbox",
  authProvider: "otp",
  grantTtlSeconds: 300,
  sessionPepper: "session-pepper",
  otpPepper: "otp-pepper",
  grantSecret: "grant-secret",
  shareLinkKey: "share-link-key",
  bootstrapAdminEmail: "ada@example.com",
  accessTeamDomain: null,
  accessAudStaff: null,
  accessAudViewer: null,
};

async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 200]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Mandoc sample", { x: 40, y: 100, size: 18, font });
  return pdf.save();
}

describe("document share security", () => {
  let db: Db;
  let storage: MemoryStorage;
  let now: number;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = testDb();
    storage = new MemoryStorage();
    now = Date.parse("2026-11-26T12:00:00Z");
    app = createApp({ db, storage, config, clock: { now: () => now } });
  });

  async function call(path: string, init: { method?: string; cookie?: string; json?: unknown; bytes?: Uint8Array; csrf?: boolean } = {}) {
    const method = init.method ?? (init.json || init.bytes ? "POST" : "GET");
    const headers = new Headers();
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.csrf !== false && method !== "GET" && method !== "HEAD") {
      headers.set(CSRF_HEADER, "1");
      headers.set("origin", origin);
    }
    let body: string | Uint8Array | undefined;
    if (init.bytes) {
      headers.set("content-type", "application/octet-stream");
      headers.set("content-length", String(init.bytes.byteLength));
      body = init.bytes;
    } else if (init.json !== undefined) {
      const raw = JSON.stringify(init.json);
      headers.set("content-type", "application/json");
      headers.set("content-length", String(new TextEncoder().encode(raw).byteLength));
      body = raw;
    }
    const response = await app.request(`${origin}${path}`, { method, headers, body });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text, bytes, headers: response.headers };
  }

  function staffCookie(setCookie: string | null): string {
    const token = cookieValue(setCookie, STAFF_COOKIE);
    if (!token) throw new Error("missing staff cookie");
    return `${STAFF_COOKIE}=${token}`;
  }

  function viewerCookie(setCookie: string | null): string {
    const token = cookieValue(setCookie, VIEWER_COOKIE);
    if (!token) throw new Error("missing viewer cookie");
    return `${VIEWER_COOKIE}=${token}`;
  }

  async function signIn(email: string): Promise<string> {
    const requested = await call("/api/auth/otp/request", { json: { email } });
    expect(requested.status).toBe(202);
    const outbox = await call("/api/dev/outbox");
    const messages = (outbox.json as { messages: { email: string; code: string }[] }).messages;
    const code = messages.find((message) => message.email === email)?.code;
    expect(code).toMatch(/^\d{6}$/);
    const verified = await call("/api/auth/otp/verify", { json: { email, code } });
    expect(verified.status).toBe(200);
    return staffCookie(verified.headers.get("set-cookie"));
  }

  async function upload(cookie: string, bytes: Uint8Array, filename: string, contentType: string) {
    const created = await call("/api/uploads", { cookie, json: { filename, contentType, byteSize: bytes.byteLength } });
    expect(created.status).toBe(200);
    const uploadId = (created.json as { uploadId: string }).uploadId;
    const part = await call(`/api/uploads/${uploadId}/parts/1`, { method: "PUT", cookie, bytes });
    expect(part.status).toBe(200);
    const done = await call(`/api/uploads/${uploadId}/complete`, { cookie, json: {} });
    expect(done.status).toBe(200);
    return (done.json as { documentId: string }).documentId;
  }

  it("checks security headers and rejects CSRF", async () => {
    const health = await call("/api/health");
    expect(health.headers.get("x-frame-options")).toBe("DENY");
    expect(health.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(health.headers.get("referrer-policy")).toBe("no-referrer");
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("strict-transport-security")).toBeNull();
    const missing = await call("/api/auth/otp/request", { json: { email: "ada@example.com" }, csrf: false });
    expect(missing.status).toBe(403);
    expect(missing.json).toEqual({ error: "csrf" });
  });

  it("rejects a wrong OTP and blocks privilege escalation", async () => {
    await call("/api/auth/otp/request", { json: { email: "bea@example.com" } });
    const wrong = await call("/api/auth/otp/verify", { json: { email: "bea@example.com", code: "000000" } });
    expect(wrong.status).toBe(401);
    expect(wrong.json).toEqual({ error: "invalid_code" });
    const member = await signIn("bea@example.com");
    const admin = await signIn("ada@example.com");
    expect((await call("/api/admin/users", { cookie: member })).status).toBe(403);
    const users = await call("/api/admin/users", { cookie: admin });
    const bea = (users.json as { users: { id: string; email: string }[] }).users.find((user) => user.email === "bea@example.com");
    const escalated = await call(`/api/admin/users/${bea?.id}`, { method: "PATCH", cookie: member, json: { role: "admin" } });
    expect(escalated.status).toBe(403);
  });

  it("shares a PDF, hides dead links, and enforces the grant", async () => {
    const ada = await signIn("ada@example.com");
    const bea = await signIn("bea@example.com");
    const pdf = await samplePdf();
    const documentId = await upload(ada, pdf, "note.pdf", "application/pdf");
    await upload(bea, pdf, "bea.pdf", "application/pdf");
    const library = await call("/api/documents", { cookie: bea });
    const titles = (library.json as { documents: { title: string }[] }).documents.map((document) => document.title);
    expect(titles).toEqual(["bea.pdf"]);
    expect((await call(`/api/documents/${documentId}`, { cookie: bea })).status).toBe(404);

    const expiresAt = now + 60 * 60 * 1000;
    const created = await call(`/api/documents/${documentId}/shares`, {
      cookie: ada,
      json: { recipientEmails: ["viewer@example.com"], expiresAt, password: "correct-horse", downloadAllowed: false, watermarkEnabled: true },
    });
    expect(created.status).toBe(201);
    const url = (created.json as { url: string; id: string }).url;
    const token = url.split("/s/")[1] ?? "";
    const share = await findShareByHash(db, await shareTokenHash(token));
    expect(share?.tokenHash).toBe(await shareTokenHash(token));
    expect(JSON.stringify(share)).not.toContain(token);

    const unknown = await call("/api/public/s/not-a-real-token-value");
    expect(unknown.status).toBe(404);
    expect(unknown.json).toEqual({ error: "not_found" });

    await call("/api/public/s/" + token + "/otp/request", { json: { email: "viewer@example.com" } });
    const badCode = await call("/api/public/s/" + token + "/otp/verify", { json: { email: "viewer@example.com", code: "111111" } });
    expect(badCode.json).toEqual({ error: "invalid_code" });
    const outbox = await call("/api/dev/outbox");
    const code = (outbox.json as { messages: { email: string; code: string; kind: string }[] }).messages.find(
      (message) => message.email === "viewer@example.com" && message.kind === "viewer_otp",
    )?.code;
    const verified = await call(`/api/public/s/${token}/otp/verify`, { json: { email: "viewer@example.com", code } });
    expect(verified.json).toEqual({ passwordRequired: true });
    const viewer = viewerCookie(verified.headers.get("set-cookie"));
    const blocked = await call(`/api/public/s/${token}/grant`, { cookie: viewer, json: {} });
    expect(blocked.json).toEqual({ error: "password_required" });
    const badPassword = await call(`/api/public/s/${token}/password`, { cookie: viewer, json: { password: "wrong-horse" } });
    expect(badPassword.status).toBe(401);
    expect((await call(`/api/public/s/${token}/password`, { cookie: viewer, json: { password: "correct-horse" } })).status).toBe(200);
    const granted = await call(`/api/public/s/${token}/grant`, { cookie: viewer, json: {} });
    expect(granted.status).toBe(200);
    const grant = (granted.json as { grant: string; watermark: boolean }).grant;
    expect((granted.json as { watermark: boolean }).watermark).toBe(true);
    const viewed = await call(`/api/view/${grant}`, { cookie: viewer });
    expect(viewed.status).toBe(200);
    expect(viewed.headers.get("content-type")).toBe("application/pdf");
    expect(viewed.text.startsWith("%PDF")).toBe(true);
    expect(Buffer.from(viewed.bytes).equals(Buffer.from(pdf))).toBe(false);
    const downloaded = await call(`/api/download/${grant}`, { cookie: viewer });
    expect(downloaded.status).toBe(403);
    expect(downloaded.json).toEqual({ error: "forbidden" });
    const forged = `${grant.slice(0, -4)}aaaa`;
    expect((await call(`/api/view/${forged}`, { cookie: viewer })).json).toEqual({ error: "invalid_grant" });
    expect((await call(`/api/view/${grant}`)).status).toBe(404);

    const shareId = (created.json as { id: string }).id;
    expect((await call(`/api/shares/${shareId}/revoke`, { method: "POST", cookie: bea })).status).toBe(404);
    expect((await call(`/api/shares/${shareId}/revoke`, { method: "POST", cookie: ada })).status).toBe(200);
    const revoked = await call(`/api/public/s/${token}`);
    expect(revoked.status).toBe(unknown.status);
    expect(revoked.json).toEqual(unknown.json);
    expect((await call(`/api/view/${grant}`, { cookie: viewer })).json).toEqual(unknown.json);

    now = expiresAt + 1;
    const expiredShare = await call(`/api/documents/${documentId}/shares`, {
      cookie: ada,
      json: { recipientEmails: ["viewer@example.com"], expiresAt: now - 1, downloadAllowed: true, watermarkEnabled: false },
    });
    expect(expiredShare.status).toBe(400);
    const later = now + 60 * 60 * 1000;
    const second = await call(`/api/documents/${documentId}/shares`, {
      cookie: ada,
      json: { recipientEmails: ["viewer@example.com"], expiresAt: later, downloadAllowed: true, watermarkEnabled: true },
    });
    const secondToken = (second.json as { url: string }).url.split("/s/")[1] ?? "";
    now = later + 1;
    const expired = await call(`/api/public/s/${secondToken}`);
    expect(expired.json).toEqual(unknown.json);
  });

  it("stamps a watermarked download and refuses an office file", async () => {
    const ada = await signIn("ada@example.com");
    const pdf = await samplePdf();
    const documentId = await upload(ada, pdf, "note.pdf", "application/pdf");
    const created = await call(`/api/documents/${documentId}/shares`, {
      cookie: ada,
      json: { recipientEmails: ["viewer@example.com"], expiresAt: now + 3_600_000, downloadAllowed: true, watermarkEnabled: true },
    });
    const token = (created.json as { url: string }).url.split("/s/")[1] ?? "";
    await call(`/api/public/s/${token}/otp/request`, { json: { email: "viewer@example.com" } });
    const outbox = await call("/api/dev/outbox");
    const code = (outbox.json as { messages: { code: string; kind: string }[] }).messages.find((message) => message.kind === "viewer_otp")?.code;
    const verified = await call(`/api/public/s/${token}/otp/verify`, { json: { email: "viewer@example.com", code } });
    const viewer = viewerCookie(verified.headers.get("set-cookie"));
    const grant = ((await call(`/api/public/s/${token}/grant`, { cookie: viewer, json: {} })).json as { grant: string }).grant;
    const stamped = await call(`/api/download/${grant}`, { cookie: viewer });
    expect(stamped.status).toBe(200);
    const latin = Buffer.from(stamped.bytes).toString("latin1");
    const inflated = [...latin.matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
      .map((match) => {
        try {
          return inflateSync(Buffer.from(match[1] ?? "", "latin1")).toString("latin1");
        } catch {
          return "";
        }
      })
      .join("\n");
    const decoded = [...inflated.matchAll(/<([0-9A-Fa-f]+)>/g)]
      .map((match) => {
        const hex = match[1] ?? "";
        let out = "";
        for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
        return out;
      })
      .join(" ");
    expect(decoded).toContain("viewer@example.com");
    expect(Buffer.from(stamped.bytes).equals(Buffer.from(pdf))).toBe(false);

    const docx = new TextEncoder().encode("not really a docx");
    const officeId = await upload(ada, docx, "sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const officeShare = await call(`/api/documents/${officeId}/shares`, {
      cookie: ada,
      json: { recipientEmails: ["viewer@example.com"], expiresAt: now + 3_600_000, downloadAllowed: true, watermarkEnabled: true },
    });
    const officeToken = (officeShare.json as { url: string }).url.split("/s/")[1] ?? "";
    await call(`/api/public/s/${officeToken}/otp/request`, { json: { email: "viewer@example.com" } });
    const box = await call("/api/dev/outbox");
    const officeCode = (box.json as { messages: { code: string; kind: string; shareId: string | null }[] }).messages.find(
      (message) => message.kind === "viewer_otp" && message.shareId,
    )?.code;
    const officeSession = await call(`/api/public/s/${officeToken}/otp/verify`, { json: { email: "viewer@example.com", code: officeCode } });
    const officeViewer = viewerCookie(officeSession.headers.get("set-cookie"));
    const officeGrant = ((await call(`/api/public/s/${officeToken}/grant`, { cookie: officeViewer, json: {} })).json as { grant: string }).grant;
    expect((await call(`/api/view/${officeGrant}`, { cookie: officeViewer })).json).toEqual({ error: "unstampable" });
    expect((await call(`/api/download/${officeGrant}`, { cookie: officeViewer })).json).toEqual({ error: "unstampable" });
  });

  it("purges deleted documents and leaves an unset lifetime alone", async () => {
    const ada = await signIn("ada@example.com");
    const pdf = await samplePdf();
    const kept = await upload(ada, pdf, "kept.pdf", "application/pdf");
    const removed = await upload(ada, pdf, "removed.pdf", "application/pdf");
    expect((await call(`/api/documents/${removed}`, { method: "DELETE", cookie: ada })).status).toBe(200);
    await runRetention({ db, storage }, now);
    expect((await call("/api/documents", { cookie: ada })).json).toMatchObject({ documents: [{ title: "kept.pdf" }] });
    await setDocumentRetentionDays(db, 1);
    now += 2 * 24 * 60 * 60 * 1000;
    await runRetention({ db, storage }, now);
    const again = await signIn("ada@example.com");
    expect((await call(`/api/documents/${kept}`, { cookie: again })).status).toBe(404);
  });
});
