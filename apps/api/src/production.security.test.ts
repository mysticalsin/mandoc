import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CSRF_HEADER, PASSWORD_ATTEMPT_LIMIT, PASSWORD_WINDOW_MS, STAFF_COOKIE, VIEWER_COOKIE, cookieValue } from "@mandoc/core";
import { MemoryStorage } from "@mandoc/cf";
import { createDb, type Db } from "@mandoc/db";
import { openTestDatabase } from "../../../packages/db/src/node-d1.ts";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";
import { runRetention } from "./retention-job.js";

const origin = "https://mandoc.example";

function testDb(): Db {
  const sql = readFileSync(fileURLToPath(new URL("../../../packages/db/migrations/0001_init.sql", import.meta.url)), "utf8");
  return createDb(openTestDatabase(sql) as D1Database);
}

describe("production config", () => {
  it("authenticates a viewer with Access, stamps the view, locks the password, and purges by the retention setting", async () => {
    const db = testDb();
    const storage = new MemoryStorage();
    let now = Date.parse("2026-11-26T12:00:00Z");
    const config = parseConfig({
      ENVIRONMENT: "production",
      APP_ORIGIN: origin,
      MAILER: "disabled",
      AUTH_PROVIDER: "cloudflare-access",
      GRANT_TTL_SECONDS: "300",
      SESSION_PEPPER: "prod-session",
      OTP_PEPPER: "prod-otp",
      GRANT_SECRET: "prod-grant",
      SHARE_LINK_KEY: "prod-share",
      BOOTSTRAP_ADMIN_EMAIL: "ada@example.com",
      ACCESS_TEAM_DOMAIN: "mantu.cloudflareaccess.com",
      ACCESS_AUD_STAFF: "staff-aud",
      ACCESS_AUD_VIEWER: "viewer-aud",
    });
    const audiences: string[] = [];
    const app = createApp({
      db,
      storage,
      config,
      clock: { now: () => now },
      verifyAccess: (jwt, audience) => {
        audiences.push(audience);
        if (audience === "staff" && jwt === "staff-jwt") return Promise.resolve({ email: "ada@example.com" });
        if (audience === "viewer" && jwt === "viewer-jwt") return Promise.resolve({ email: "viewer@example.com" });
        return Promise.resolve(null);
      },
    });

    async function call(path: string, init: { method?: string; cookie?: string; json?: unknown; jwt?: string; range?: string } = {}) {
      const method = init.method ?? (init.json ? "POST" : "GET");
      const headers = new Headers();
      if (init.cookie) headers.set("cookie", init.cookie);
      if (init.jwt) headers.set("cf-access-jwt-assertion", init.jwt);
      if (init.range) headers.set("range", init.range);
      if (method !== "GET" && method !== "HEAD") {
        headers.set(CSRF_HEADER, "1");
        headers.set("origin", origin);
      }
      let body: string | Uint8Array | undefined;
      if (init.json !== undefined) {
        body = JSON.stringify(init.json);
        headers.set("content-type", "application/json");
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
      return { status: response.status, json, bytes, headers: response.headers };
    }

    expect((await call("/api/public/s/anything/otp/request", { json: { email: "viewer@example.com" } })).status).toBe(404);
    expect((await call("/api/public/s/anything/otp/verify", { json: { email: "viewer@example.com", code: "000000" } })).status).toBe(404);
    expect((await call("/api/dev/outbox")).status).toBe(404);
    expect((await call("/auth/s/not-a-real-token-value", { jwt: "viewer-jwt" })).json).toEqual({ error: "not_found" });

    const staff = await call("/auth/access/staff", { jwt: "staff-jwt" });
    expect(staff.status).toBe(302);
    expect(audiences).toContain("staff");
    const staffCookie = `${STAFF_COOKIE}=${cookieValue(staff.headers.get("set-cookie"), STAFF_COOKIE) ?? ""}`;

    const pdf = await PDFDocument.create();
    pdf.addPage([300, 200]).drawText("original", { x: 40, y: 100, size: 18, font: await pdf.embedFont(StandardFonts.Helvetica) });
    const file = await pdf.save();
    const created = await call("/api/uploads", { cookie: staffCookie, json: { filename: "note.pdf", contentType: "application/pdf", byteSize: file.byteLength } });
    const uploadId = (created.json as { uploadId: string }).uploadId;
    const partHeaders = new Headers({
      cookie: staffCookie,
      [CSRF_HEADER]: "1",
      origin,
      "content-type": "application/octet-stream",
      "content-length": String(file.byteLength),
    });
    expect((await app.request(`${origin}/api/uploads/${uploadId}/parts/1`, { method: "PUT", headers: partHeaders, body: file })).status).toBe(200);
    const done = await call(`/api/uploads/${uploadId}/complete`, { cookie: staffCookie, json: {} });
    const documentId = (done.json as { documentId: string }).documentId;
    const share = await call(`/api/documents/${documentId}/shares`, {
      cookie: staffCookie,
      json: {
        recipientEmails: ["viewer@example.com"],
        expiresAt: now + 60 * 60 * 1000,
        password: "correct-horse",
        downloadAllowed: false,
        watermarkEnabled: true,
      },
    });
    const token = (share.json as { url: string }).url.split("/s/")[1] ?? "";

    const missing = await call(`/auth/s/${token}`);
    expect(missing.status).toBe(401);
    const wrongAudience = await call(`/auth/s/${token}`, { jwt: "staff-jwt" });
    expect(wrongAudience.status).toBe(401);
    const viewer = await call(`/auth/s/${token}`, { jwt: "viewer-jwt" });
    expect(viewer.status).toBe(302);
    expect(audiences).toContain("viewer");
    const viewerCookie = `${VIEWER_COOKIE}=${cookieValue(viewer.headers.get("set-cookie"), VIEWER_COOKIE) ?? ""}`;

    for (let attempt = 0; attempt < PASSWORD_ATTEMPT_LIMIT; attempt += 1) {
      const wrong = await call(`/api/public/s/${token}/password`, { cookie: viewerCookie, json: { password: `wrong-horse-${attempt}` } });
      expect(wrong.status).toBe(401);
    }
    const locked = await call(`/api/public/s/${token}/password`, { cookie: viewerCookie, json: { password: "correct-horse" } });
    expect(locked.status).toBe(401);
    now += PASSWORD_WINDOW_MS + 1;
    expect((await call(`/api/public/s/${token}/password`, { cookie: viewerCookie, json: { password: "correct-horse" } })).status).toBe(200);

    const grant = ((await call(`/api/public/s/${token}/grant`, { cookie: viewerCookie, json: {} })).json as { grant: string }).grant;
    const viewed = await call(`/api/view/${grant}`, { cookie: viewerCookie });
    expect(viewed.status).toBe(200);
    expect(Buffer.from(viewed.bytes).equals(Buffer.from(file))).toBe(false);
    const ranged = await call(`/api/view/${grant}`, { cookie: viewerCookie, range: "bytes=0-32" });
    expect(ranged.headers.get("content-range")).not.toContain(`/${file.byteLength}`);
    expect((await call(`/api/download/${grant}`, { cookie: viewerCookie })).status).toBe(403);

    expect((await call("/api/admin/retention", { cookie: staffCookie })).json).toEqual({ days: null });
    expect((await call("/api/admin/retention", { method: "PATCH", cookie: staffCookie, json: { days: 1 } })).json).toEqual({ days: 1 });
    now += 2 * 24 * 60 * 60 * 1000;
    await runRetention({ db, storage }, now);
    const again = await call("/auth/access/staff", { jwt: "staff-jwt" });
    const againCookie = `${STAFF_COOKIE}=${cookieValue(again.headers.get("set-cookie"), STAFF_COOKIE) ?? ""}`;
    expect((await call(`/api/documents/${documentId}`, { cookie: againCookie })).status).toBe(404);
  });
});
