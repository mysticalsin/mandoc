import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CSRF_HEADER, STAFF_COOKIE, cookieValue, shareTokenHash } from "@mandoc/core";
import { MemoryStorage } from "@mandoc/cf";
import { createDb, findShareByHash, type Db } from "@mandoc/db";
import { openTestDatabase } from "../../packages/db/src/node-d1.ts";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createApp } from "../../apps/api/src/app.ts";
import { parseConfig, type AppConfig } from "../../apps/api/src/config.ts";

const origin = "http://127.0.0.1:8791";
const results: { name: string; pass: boolean; detail: string }[] = [];

function record(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

const config: AppConfig = {
  environment: "development",
  appOrigin: origin,
  mailer: "dev-outbox",
  authProvider: "otp",
  grantTtlSeconds: 300,
  sessionPepper: "attack-session",
  otpPepper: "attack-otp",
  grantSecret: "attack-grant",
  shareLinkKey: "attack-share",
  bootstrapAdminEmail: "ada@example.com",
  accessTeamDomain: null,
  accessAudStaff: null,
  accessAudViewer: null,
};

function database(): Db {
  const sql = readFileSync(fileURLToPath(new URL("../../packages/db/migrations/0001_init.sql", import.meta.url)), "utf8");
  return createDb(openTestDatabase(sql) as D1Database);
}

async function call(app: ReturnType<typeof createApp>, path: string, init: { method?: string; cookie?: string; json?: unknown; csrf?: boolean; url?: string } = {}) {
  const method = init.method ?? (init.json ? "POST" : "GET");
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.csrf !== false && method !== "GET" && method !== "HEAD") {
    headers.set(CSRF_HEADER, "1");
    headers.set("origin", origin);
  }
  let body: string | undefined;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers.set("content-type", "application/json");
  }
  const response = await app.request(`${init.url ?? origin}${path}`, { method, headers, body });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, headers: response.headers };
}

async function main() {
  try {
    parseConfig({ ENVIRONMENT: "production", AUTH_PROVIDER: "otp", APP_ORIGIN: "https://mandoc.example", SESSION_PEPPER: "a", OTP_PEPPER: "b", GRANT_SECRET: "c", SHARE_LINK_KEY: "d", BOOTSTRAP_ADMIN_EMAIL: "ada@example.com", ACCESS_TEAM_DOMAIN: "t", ACCESS_AUD_STAFF: "s", ACCESS_AUD_VIEWER: "v" });
    record("production refuses local OTP", false);
  } catch {
    record("production refuses local OTP", true);
  }

  const db = database();
  const app = createApp({ db, storage: new MemoryStorage(), config, clock: { now: () => Date.parse("2026-11-26T12:00:00Z") } });
  const health = await call(app, "/api/health");
  const csp = health.headers.get("content-security-policy") ?? "";
  record("CSP script-src self", csp.includes("script-src 'self'") && !csp.includes("unsafe-eval"));
  record("frame denial", health.headers.get("x-frame-options") === "DENY" && csp.includes("frame-ancestors 'none'"));
  record("nosniff and no-referrer", health.headers.get("x-content-type-options") === "nosniff" && health.headers.get("referrer-policy") === "no-referrer");
  record("COOP and permissions policy", health.headers.get("cross-origin-opener-policy") === "same-origin" && (health.headers.get("permissions-policy") ?? "").includes("camera=()"));
  record("no HSTS on http", health.headers.get("strict-transport-security") == null);
  const https = await call(app, "/api/health", { url: "https://mandoc.example" });
  record("HSTS on https", (https.headers.get("strict-transport-security") ?? "").includes("max-age="));
  const csrf = await call(app, "/api/auth/otp/request", { json: { email: "ada@example.com" }, csrf: false });
  record("CSRF failure", csrf.status === 403 && JSON.stringify(csrf.json) === JSON.stringify({ error: "csrf" }));

  await call(app, "/api/auth/otp/request", { json: { email: "ada@example.com" } });
  const wrong = await call(app, "/api/auth/otp/verify", { json: { email: "ada@example.com", code: "000000" } });
  record("wrong OTP", wrong.status === 401);
  const outbox = await call(app, "/api/dev/outbox");
  const code = (outbox.json as { messages: { code: string }[] }).messages[0]?.code ?? "";
  const verified = await call(app, "/api/auth/otp/verify", { json: { email: "ada@example.com", code } });
  const token = cookieValue(verified.headers.get("set-cookie"), STAFF_COOKIE);
  const cookie = `${STAFF_COOKIE}=${token ?? ""}`;
  const cookieHeader = verified.headers.get("set-cookie") ?? "";
  record(
    "staff cookie flags",
    cookieHeader.includes("__Host-mandoc_session=") && cookieHeader.includes("HttpOnly") && cookieHeader.includes("Secure") && cookieHeader.includes("SameSite=Lax") && cookieHeader.includes("Path=/"),
  );

  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  page.drawText("attack", { font: await pdf.embedFont(StandardFonts.Helvetica), x: 40, y: 100, size: 12 });
  const bytes = await pdf.save();
  const created = await call(app, "/api/uploads", { cookie, json: { filename: "a.pdf", contentType: "application/pdf", byteSize: bytes.byteLength } });
  const uploadId = (created.json as { uploadId: string }).uploadId;
  const headers = new Headers({ cookie, [CSRF_HEADER]: "1", origin, "content-type": "application/octet-stream", "content-length": String(bytes.byteLength) });
  const part = await app.request(`${origin}/api/uploads/${uploadId}/parts/1`, { method: "PUT", headers, body: bytes });
  record("multipart part accepted", part.status === 200);
  const done = await call(app, `/api/uploads/${uploadId}/complete`, { cookie, json: {} });
  const documentId = (done.json as { documentId: string }).documentId;
  const share = await call(app, `/api/documents/${documentId}/shares`, {
    cookie,
    json: { recipientEmails: ["viewer@example.com"], expiresAt: Date.parse("2026-11-26T13:00:00Z"), downloadAllowed: false, watermarkEnabled: true },
  });
  const url = (share.json as { url: string; id: string }).url;
  const shareToken = url.split("/s/")[1] ?? "";
  const row = await findShareByHash(db, await shareTokenHash(shareToken));
  record("share token stored as hash", row?.tokenHash === (await shareTokenHash(shareToken)) && !JSON.stringify(row).includes(shareToken));
  const unknown = await call(app, "/api/public/s/not-a-real-token-value");
  await call(app, `/api/shares/${(share.json as { id: string }).id}/revoke`, { method: "POST", cookie });
  const revoked = await call(app, `/api/public/s/${shareToken}`);
  record("revoked link matches unknown link", revoked.status === unknown.status && JSON.stringify(revoked.json) === JSON.stringify(unknown.json));

  await call(app, "/api/auth/otp/request", { json: { email: "bea@example.com" } });
  const beaBox = await call(app, "/api/dev/outbox");
  const beaCode = (beaBox.json as { messages: { email: string; code: string }[] }).messages.find((message) => message.email === "bea@example.com")?.code;
  const bea = await call(app, "/api/auth/otp/verify", { json: { email: "bea@example.com", code: beaCode } });
  const beaCookie = `${STAFF_COOKIE}=${cookieValue(bea.headers.get("set-cookie"), STAFF_COOKIE) ?? ""}`;
  const escalated = await call(app, "/api/admin/users", { cookie: beaCookie });
  record("privilege escalation blocked", escalated.status === 403);
  const foreign = await call(app, `/api/documents/${documentId}`, { cookie: beaCookie });
  record("cross-tenant document hidden", foreign.status === 404);

  const base = process.env.BASE_URL;
  if (base) {
    const live = await fetch(new URL("/api/health", base));
    record("live health", live.status === 200);
    record("live nosniff", live.headers.get("x-content-type-options") === "nosniff");
  }

  const failed = results.filter((item) => !item.pass);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
}

await main();
