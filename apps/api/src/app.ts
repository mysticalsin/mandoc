import {
  AUDIT,
  CSRF_HEADER,
  FILE_TYPES,
  OTP_EMAIL_LIMIT,
  OTP_TTL_MS,
  OTP_WINDOW_MS,
  PART_SIZE,
  STAFF_ABSOLUTE_MS,
  VIEWER_COOKIE,
  STAFF_COOKIE,
  canChangeUser,
  canReadDocument,
  canWriteDocument,
  clearCookie,
  cookieValue,
  csrfAllows,
  PASSWORD_ATTEMPT_LIMIT,
  PASSWORD_WINDOW_MS,
  downloadDecision,
  viewDecision,
  expiryAllowed,
  generateOtpCode,
  grantMatchesShare,
  hashOtp,
  hashPassword,
  hiddenBody,
  hmacHex,
  newShareToken,
  openSecret,
  otpMatches,
  otpStillValid,
  passwordPolicy,
  planPartCount,
  randomBytes,
  randomId,
  rateAllows,
  readGrant,
  safeFilename,
  sealSecret,
  securityHeaders,
  sessionCookie,
  shareTokenHash,
  shareVisibility,
  signGrant,
  staffSessionExpiry,
  staffSessionLive,
  systemClock,
  uploadAllowed,
  verifyPassword,
  viewerSessionExpiry,
  detectFileType,
  bytesToBase64Url,
  eventSchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordSchema,
  retentionSchema,
  roleChangeSchema,
  shareCreateSchema,
  uploadCreateSchema,
  type Actor,
  type Clock,
  type DocumentStorage,
  type FileType,
  type GrantClaims,
  type Mailer,
  type OutboundMail,
} from "@mandoc/core";
import {
  bumpRate,
  countOpens,
  documentRetentionDays,
  deleteSessionByHash,
  findDocument,
  findGrant,
  findOtp,
  findSessionByHash,
  findShareByHash,
  findShareById,
  findUpload,
  findUserByEmail,
  findUserById,
  findVersion,
  findViewerSessionByHash,
  incrementOtpAttempts,
  insertDocumentGraph,
  insertGrant,
  insertOutbox,
  insertSession,
  insertShare,
  setDocumentRetentionDays,
  setMultipartId,
  insertUser,
  insertViewerSession,
  latestReadyVersion,
  listAllShares,
  listAudit,
  listLibrary,
  listOutbox,
  listSharesForDocument,
  listUsers,
  markUploadFailed,
  markUploadReady,
  markViewerPassword,
  readParts,
  recordEvent,
  replaceOtp,
  deleteOtp,
  revokeShare,
  saveUploadPart,
  shareRecipientsOf,
  softDeleteDocument,
  touchSession,
  updateUser,
  writeAudit,
  type Db,
  type UserRecord,
} from "@mandoc/db";
import { Hono, type Context } from "hono";
import type { AppConfig } from "./config.js";
import { stampPdf } from "./stamp.js";

export interface AppDeps {
  db: Db;
  storage: DocumentStorage;
  config: AppConfig;
  clock?: Clock;
  verifyAccess?: (jwt: string, audience: "staff" | "viewer") => Promise<{ email: string } | null>;
  assets?: { fetch(request: Request): Promise<Response> };
}

function mailerFor(deps: AppDeps, clock: Clock): Mailer {
  if (deps.config.mailer !== "dev-outbox") return { async send() {} };
  return {
    async send(mail: OutboundMail) {
      await insertOutbox(deps.db, { kind: mail.kind, email: mail.to, code: mail.code, shareId: mail.shareId, now: clock.now() });
    },
  };
}

export function createApp(deps: AppDeps) {
  const clock = deps.clock ?? systemClock;
  const { db, storage, config } = deps;
  const mailer = mailerFor(deps, clock);
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    const https = new URL(c.req.url).protocol === "https:";
    for (const [key, value] of Object.entries(securityHeaders(https))) c.header(key, value);
  });

  app.use("/api/*", async (c, next) => {
    const method = c.req.method;
    if (
      !csrfAllows({
        method,
        origin: c.req.header("origin") ?? null,
        appOrigin: config.appOrigin,
        requestHeader: c.req.header(CSRF_HEADER) ?? null,
      })
    ) {
      return c.json({ error: "csrf" }, 403);
    }
    const length = Number(c.req.header("content-length") ?? "0");
    const type = c.req.header("content-type") ?? "";
    if (type.includes("json") && length > 65_536) return c.json({ error: "too_large" }, 413);
    await next();
  });

  app.onError((error, c) => {
    console.error(error instanceof Error ? error.message : "error");
    return c.json({ error: "internal" }, 500);
  });

  const actorOf = (user: UserRecord): Actor => ({
    id: user.id,
    email: user.email,
    role: user.role,
    disabledAt: user.disabledAt,
  });

  async function requireUser(c: Context): Promise<UserRecord | Response> {
    const token = cookieValue(c.req.header("cookie"), STAFF_COOKIE);
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const session = await findSessionByHash(db, await hmacHex(token, config.sessionPepper));
    const now = clock.now();
    if (!session || !staffSessionLive(session, now)) return c.json({ error: "unauthorized" }, 401);
    const user = await findUserById(db, session.userId);
    if (!user || user.disabledAt != null) return c.json({ error: "unauthorized" }, 401);
    await touchSession(db, session.id, now);
    return user;
  }

  async function requireAdmin(c: Context): Promise<UserRecord | Response> {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    if (user.role !== "admin") return c.json({ error: "forbidden" }, 403);
    return user;
  }

  async function requireViewer(c: Context) {
    const token = cookieValue(c.req.header("cookie"), VIEWER_COOKIE);
    if (!token) return null;
    const session = await findViewerSessionByHash(db, await hmacHex(token, config.sessionPepper));
    if (!session || session.expiresAt <= clock.now()) return null;
    return session;
  }

  async function liveShare(token: string) {
    const share = await findShareByHash(db, await shareTokenHash(token));
    if (!share || shareVisibility({ revokedAt: share.revokedAt ?? null, expiresAt: share.expiresAt }, clock.now()) !== "live") return null;
    const document = await findDocument(db, share.documentId);
    if (!document || document.deletedAt != null || document.status !== "ready") return null;
    const version = await findVersion(db, share.versionId);
    if (!version || version.status !== "ready") return null;
    return { share, document, version };
  }

  async function openViewer(share: { id: string; expiresAt: number; passwordHash: string | null }, email: string): Promise<string> {
    const now = clock.now();
    const recipients = await shareRecipientsOf(db, share.id);
    if (!recipients.includes(email)) {
      await writeAudit(db, {
        actorId: null,
        actorEmail: email,
        action: AUDIT.forward,
        targetType: "share",
        targetId: share.id,
        metadata: {},
        now,
      });
    }
    const raw = bytesToBase64Url(randomBytes(32));
    await insertViewerSession(db, {
      shareId: share.id,
      email,
      tokenHash: await hmacHex(raw, config.sessionPepper),
      passwordOk: share.passwordHash == null,
      now,
      expiresAt: viewerSessionExpiry(now, share.expiresAt),
    });
    return raw;
  }

  async function issueStaff(email: string): Promise<string> {
    const now = clock.now();
    let user = await findUserByEmail(db, email);
    if (!user) {
      user = await insertUser(db, { email, role: email === config.bootstrapAdminEmail ? "admin" : "member", now });
    }
    if (user.disabledAt != null) throw new Error("disabled");
    const token = bytesToBase64Url(randomBytes(32));
    await insertSession(db, {
      userId: user.id,
      tokenHash: await hmacHex(token, config.sessionPepper),
      now,
      expiresAt: staffSessionExpiry(now),
    });
    await writeAudit(db, {
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT.signIn,
      targetType: "user",
      targetId: user.id,
      metadata: { role: user.role },
      now,
    });
    return token;
  }

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/auth/otp/request", async (c) => {
    if (config.authProvider !== "otp") return c.json({ error: "not_found" }, 404);
    const parsed = otpRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid" }, 400);
    const email = parsed.data.email;
    const now = clock.now();
    const ip = c.req.header("cf-connecting-ip") ?? "local";
    const emailCount = await bumpRate(db, `staff-otp:${email}`, OTP_WINDOW_MS, now);
    const ipCount = await bumpRate(db, `staff-otp-ip:${ip}`, OTP_WINDOW_MS, now);
    if (rateAllows(emailCount - 1, OTP_EMAIL_LIMIT) && rateAllows(ipCount - 1, 30)) {
      const code = generateOtpCode();
      await replaceOtp(db, {
        purpose: "staff",
        email,
        shareId: null,
        codeHash: await hashOtp(code, config.otpPepper),
        now,
        expiresAt: now + OTP_TTL_MS,
      });
      await mailer.send({ to: email, subject: "ManDoc code", text: code, code, kind: "staff_otp", shareId: null });
    }
    return c.json({ status: "accepted" }, 202);
  });

  app.post("/api/auth/otp/verify", async (c) => {
    if (config.authProvider !== "otp") return c.json({ error: "not_found" }, 404);
    const parsed = otpVerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_code" }, 401);
    const challenge = await findOtp(db, "staff", parsed.data.email, null);
    const now = clock.now();
    const submitted = await hashOtp(parsed.data.code, config.otpPepper);
    if (!challenge || !otpStillValid({ expiresAt: challenge.expiresAt, attempts: challenge.attempts, now }) || !otpMatches(submitted, challenge.codeHash)) {
      if (challenge) await incrementOtpAttempts(db, challenge.id);
      return c.json({ error: "invalid_code" }, 401);
    }
    await deleteOtp(db, challenge.id);
    try {
      const token = await issueStaff(parsed.data.email);
      c.header("set-cookie", sessionCookie(STAFF_COOKIE, token, Math.floor(STAFF_ABSOLUTE_MS / 1000)));
      const user = await findUserByEmail(db, parsed.data.email);
      return c.json({ email: parsed.data.email, role: user?.role ?? "member" });
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
  });

  app.post("/api/auth/sign-out", async (c) => {
    const token = cookieValue(c.req.header("cookie"), STAFF_COOKIE);
    if (token) await deleteSessionByHash(db, await hmacHex(token, config.sessionPepper));
    c.header("set-cookie", clearCookie(STAFF_COOKIE));
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    return c.json({ id: user.id, email: user.email, role: user.role });
  });

  app.get("/auth/access/staff", async (c) => {
    if (config.authProvider !== "cloudflare-access" || !deps.verifyAccess) return c.json({ error: "not_found" }, 404);
    const jwt = c.req.header("cf-access-jwt-assertion");
    const verified = jwt ? await deps.verifyAccess(jwt, "staff") : null;
    if (!verified) return c.json({ error: "unauthorized" }, 401);
    try {
      const token = await issueStaff(verified.email);
      c.header("set-cookie", sessionCookie(STAFF_COOKIE, token, Math.floor(STAFF_ABSOLUTE_MS / 1000)));
      return c.redirect(`${config.appOrigin}/library`);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
  });

  app.get("/auth/s/:token", async (c) => {
    if (config.authProvider !== "cloudflare-access" || !deps.verifyAccess) return c.json({ error: "not_found" }, 404);
    const shareToken = c.req.param("token");
    if (!shareToken) return c.json(hiddenBody(), 404);
    const live = await liveShare(shareToken);
    if (!live) return c.json(hiddenBody(), 404);
    const jwt = c.req.header("cf-access-jwt-assertion");
    const verified = jwt ? await deps.verifyAccess(jwt, "viewer") : null;
    if (!verified) return c.json({ error: "unauthorized" }, 401);
    const raw = await openViewer(live.share, verified.email);
    const now = clock.now();
    c.header("set-cookie", sessionCookie(VIEWER_COOKIE, raw, Math.floor((viewerSessionExpiry(now, live.share.expiresAt) - now) / 1000)));
    return c.redirect(`${config.appOrigin}/s/${shareToken}`);
  });

  app.post("/api/uploads", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const parsed = uploadCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid" }, 400);
    const filename = safeFilename(parsed.data.filename);
    const fileType = filename ? detectFileType(filename, parsed.data.contentType) : null;
    if (!filename || !fileType || !uploadAllowed(parsed.data.byteSize)) return c.json({ error: "invalid" }, 400);
    const graph = await insertDocumentGraph(db, {
      ownerId: user.id,
      title: filename,
      filename,
      contentType: FILE_TYPES[fileType],
      fileType,
      byteSize: parsed.data.byteSize,
      partSize: PART_SIZE,
      multipartId: randomId("pending"),
      now: clock.now(),
    });
    try {
      const created = await storage.createUpload(graph.r2Key, FILE_TYPES[fileType]);
      await setMultipartId(db, graph.uploadId, created.uploadId);
    } catch {
      await markUploadFailed(db, graph.uploadId);
      return c.json({ error: "internal" }, 500);
    }
    return c.json({
      uploadId: graph.uploadId,
      documentId: graph.documentId,
      partSize: PART_SIZE,
      partCount: planPartCount(parsed.data.byteSize),
    });
  });

  app.put("/api/uploads/:id/parts/:part", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const upload = await findUpload(db, c.req.param("id"));
    if (!upload || upload.ownerId !== user.id || upload.status !== "uploading") return c.json({ error: "not_found" }, 404);
    const partNumber = Number(c.req.param("part"));
    const partCount = planPartCount(upload.byteSize, upload.partSize);
    const length = Number(c.req.header("content-length") ?? "");
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount || !Number.isInteger(length)) {
      return c.json({ error: "invalid" }, 400);
    }
    const last = partNumber === partCount;
    if (length <= 0 || length > upload.partSize || (!last && length !== upload.partSize)) return c.json({ error: "invalid" }, 400);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength !== length) return c.json({ error: "invalid" }, 400);
    const stored = await storage.putPart(upload.r2Key, upload.multipartId, partNumber, bytes);
    const parts = readParts(upload.receivedParts).filter((part) => part.partNumber !== partNumber);
    parts.push({ partNumber, etag: stored.etag, size: bytes.byteLength });
    await saveUploadPart(db, upload.id, parts);
    return c.json({ partNumber, etag: stored.etag });
  });

  app.post("/api/uploads/:id/complete", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const upload = await findUpload(db, c.req.param("id"));
    if (!upload || upload.ownerId !== user.id || upload.status !== "uploading") return c.json({ error: "not_found" }, 404);
    const parts = readParts(upload.receivedParts).sort((a, b) => a.partNumber - b.partNumber);
    const expected = planPartCount(upload.byteSize, upload.partSize);
    const total = parts.reduce((sum, part) => sum + part.size, 0);
    const complete = total === upload.byteSize && parts.length === expected && parts.every((part, index) => part.partNumber === index + 1);
    if (!complete) return c.json({ error: "invalid" }, 400);
    try {
      await storage.completeUpload(upload.r2Key, upload.multipartId, parts);
      await markUploadReady(db, upload.id);
    } catch {
      await markUploadFailed(db, upload.id);
      return c.json({ error: "internal" }, 500);
    }
    await writeAudit(db, {
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT.upload,
      targetType: "document",
      targetId: upload.documentId,
      metadata: { byteSize: upload.byteSize },
      now: clock.now(),
    });
    return c.json({ documentId: upload.documentId });
  });

  app.get("/api/documents", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    return c.json({ documents: await listLibrary(db, user) });
  });

  app.get("/api/documents/:id", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const document = await findDocument(db, c.req.param("id"));
    if (!document || !canReadDocument(actorOf(user), { ownerId: document.ownerId, deletedAt: document.deletedAt ?? null })) {
      return c.json({ error: "not_found" }, 404);
    }
    const version = await latestReadyVersion(db, document.id);
    const shareRows = await listSharesForDocument(db, document.id);
    const shareList = [];
    for (const share of shareRows) {
      shareList.push({
        id: share.id,
        expiresAt: share.expiresAt,
        revokedAt: share.revokedAt,
        downloadAllowed: share.downloadAllowed,
        watermarkEnabled: share.watermarkEnabled,
        createdAt: share.createdAt,
        recipients: await shareRecipientsOf(db, share.id),
        opens: await countOpens(db, share.id),
      });
    }
    return c.json({
      id: document.id,
      title: document.title,
      ownerId: document.ownerId,
      fileType: version?.fileType ?? null,
      byteSize: version?.byteSize ?? null,
      filename: version?.filename ?? null,
      versionId: version?.id ?? null,
      shares: shareList,
    });
  });

  app.delete("/api/documents/:id", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const document = await findDocument(db, c.req.param("id"));
    if (!document || !canWriteDocument(actorOf(user), { ownerId: document.ownerId, deletedAt: document.deletedAt ?? null })) {
      return c.json({ error: "not_found" }, 404);
    }
    const version = await latestReadyVersion(db, document.id);
    if (version) await storage.delete(version.r2Key);
    await softDeleteDocument(db, document.id, clock.now());
    await writeAudit(db, {
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT.delete,
      targetType: "document",
      targetId: document.id,
      metadata: {},
      now: clock.now(),
    });
    return c.json({ ok: true });
  });

  app.post("/api/documents/:id/shares", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const document = await findDocument(db, c.req.param("id"));
    if (!document || !canWriteDocument(actorOf(user), { ownerId: document.ownerId, deletedAt: document.deletedAt ?? null })) {
      return c.json({ error: "not_found" }, 404);
    }
    const version = await latestReadyVersion(db, document.id);
    if (!version) return c.json({ error: "not_found" }, 404);
    const parsed = shareCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !expiryAllowed(parsed.data.expiresAt, clock.now())) return c.json({ error: "invalid" }, 400);
    let passwordHash: string | null = null;
    if (parsed.data.password) {
      if (passwordPolicy(parsed.data.password) !== "ok") return c.json({ error: "invalid" }, 400);
      passwordHash = await hashPassword(parsed.data.password);
    }
    const token = newShareToken();
    const now = clock.now();
    const id = await insertShare(db, {
      documentId: document.id,
      versionId: version.id,
      createdBy: user.id,
      tokenHash: await shareTokenHash(token),
      sealedToken: await sealSecret(token, config.shareLinkKey),
      expiresAt: parsed.data.expiresAt,
      passwordHash,
      downloadAllowed: parsed.data.downloadAllowed,
      watermarkEnabled: parsed.data.watermarkEnabled,
      recipients: [...new Set(parsed.data.recipientEmails)],
      now,
    });
    await writeAudit(db, {
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT.shareCreate,
      targetType: "share",
      targetId: id,
      metadata: {
        download: parsed.data.downloadAllowed,
        watermark: parsed.data.watermarkEnabled,
        recipients: parsed.data.recipientEmails.length,
      },
      now,
    });
    return c.json({ id, url: `${config.appOrigin}/s/${token}` }, 201);
  });

  app.get("/api/shares/:id/link", async (c) => {
    const user = await requireUser(c);
    if (user instanceof Response) return user;
    const share = await findShareById(db, c.req.param("id"));
    if (!share) return c.json({ error: "not_found" }, 404);
    const document = await findDocument(db, share.documentId);
    if (!document || !canReadDocument(actorOf(user), { ownerId: document.ownerId, deletedAt: document.deletedAt ?? null })) {
      return c.json({ error: "not_found" }, 404);
    }
    const token = await openSecret(share.sealedToken, config.shareLinkKey);
    await writeAudit(db, {
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT.linkView,
      targetType: "share",
      targetId: share.id,
      metadata: {},
      now: clock.now(),
    });
    return c.json({ url: `${config.appOrigin}/s/${token}` });
  });

  app.post("/api/shares/:id/revoke", async (c) => revoke(c, false));
  app.post("/api/admin/shares/:id/revoke", async (c) => revoke(c, true));

  async function revoke(c: Context, admin: boolean) {
    const user = admin ? await requireAdmin(c) : await requireUser(c);
    if (user instanceof Response) return user;
    const shareId = c.req.param("id");
    if (!shareId) return c.json({ error: "not_found" }, 404);
    const share = await findShareById(db, shareId);
    if (!share) return c.json({ error: "not_found" }, 404);
    const document = await findDocument(db, share.documentId);
    if (!document || !canWriteDocument(actorOf(user), { ownerId: document.ownerId, deletedAt: document.deletedAt ?? null })) {
      return c.json({ error: "not_found" }, 404);
    }
    const now = clock.now();
    await revokeShare(db, share.id, now);
    await writeAudit(db, {
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT.shareRevoke,
      targetType: "share",
      targetId: share.id,
      metadata: {},
      now,
    });
    return c.json({ ok: true });
  }

  app.get("/api/public/s/:token", async (c) => {
    const live = await liveShare(c.req.param("token"));
    if (!live) return c.json(hiddenBody(), 404);
    return c.json({
      title: live.document.title,
      fileType: live.version.fileType,
      expiresAt: live.share.expiresAt,
      passwordRequired: live.share.passwordHash != null,
      signIn: config.authProvider === "cloudflare-access" ? "access" : "otp",
    });
  });

  app.post("/api/public/s/:token/otp/request", async (c) => {
    if (config.authProvider !== "otp") return c.json({ error: "not_found" }, 404);
    const parsed = otpRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid" }, 400);
    const live = await liveShare(c.req.param("token"));
    const now = clock.now();
    const email = parsed.data.email;
    const emailCount = await bumpRate(db, `viewer-otp:${email}`, OTP_WINDOW_MS, now);
    if (live && rateAllows(emailCount - 1, OTP_EMAIL_LIMIT)) {
      const code = generateOtpCode();
      await replaceOtp(db, {
        purpose: "viewer",
        email,
        shareId: live.share.id,
        codeHash: await hashOtp(code, config.otpPepper),
        now,
        expiresAt: now + OTP_TTL_MS,
      });
      await mailer.send({ to: email, subject: "ManDoc code", text: code, code, kind: "viewer_otp", shareId: live.share.id });
    }
    return c.json({ status: "accepted" }, 202);
  });

  app.post("/api/public/s/:token/otp/verify", async (c) => {
    if (config.authProvider !== "otp") return c.json({ error: "not_found" }, 404);
    const parsed = otpVerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_code" }, 401);
    const live = await liveShare(c.req.param("token"));
    const challenge = live ? await findOtp(db, "viewer", parsed.data.email, live.share.id) : null;
    const now = clock.now();
    const submitted = await hashOtp(parsed.data.code, config.otpPepper);
    if (!live || !challenge || !otpStillValid({ expiresAt: challenge.expiresAt, attempts: challenge.attempts, now }) || !otpMatches(submitted, challenge.codeHash)) {
      if (challenge) await incrementOtpAttempts(db, challenge.id);
      return c.json({ error: "invalid_code" }, 401);
    }
    await deleteOtp(db, challenge.id);
    const raw = await openViewer(live.share, parsed.data.email);
    c.header("set-cookie", sessionCookie(VIEWER_COOKIE, raw, Math.floor((viewerSessionExpiry(now, live.share.expiresAt) - now) / 1000)));
    return c.json({ passwordRequired: live.share.passwordHash != null });
  });

  app.post("/api/public/s/:token/password", async (c) => {
    const live = await liveShare(c.req.param("token"));
    const session = await requireViewer(c);
    if (!live || !session || session.shareId !== live.share.id) return c.json({ error: "unauthorized" }, 401);
    const parsed = passwordSchema.safeParse(await c.req.json().catch(() => null));
    const attempts = await bumpRate(db, `share-password:${live.share.id}:${session.email}`, PASSWORD_WINDOW_MS, clock.now());
    if (!rateAllows(attempts - 1, PASSWORD_ATTEMPT_LIMIT)) return c.json({ error: "invalid_password" }, 401);
    if (!parsed.success || !live.share.passwordHash || !(await verifyPassword(parsed.data.password, live.share.passwordHash))) {
      return c.json({ error: "invalid_password" }, 401);
    }
    await markViewerPassword(db, session.id);
    return c.json({ ok: true });
  });

  app.post("/api/public/s/:token/grant", async (c) => {
    const live = await liveShare(c.req.param("token"));
    const session = await requireViewer(c);
    if (!live || !session || session.shareId !== live.share.id) return c.json(hiddenBody(), 404);
    if (live.share.passwordHash && !session.passwordOk) return c.json({ error: "password_required" }, 401);
    const now = clock.now();
    const exp = Math.floor(now / 1000) + config.grantTtlSeconds;
    const claims: GrantClaims = {
      v: 1,
      jti: randomId("gnt"),
      shareId: live.share.id,
      documentId: live.document.id,
      versionId: live.version.id,
      sessionId: session.id,
      email: session.email,
      exp,
      watermark: live.share.watermarkEnabled,
    };
    const grant = await signGrant(claims, config.grantSecret);
    await insertGrant(db, { jti: claims.jti, shareId: claims.shareId, sessionId: claims.sessionId, versionId: claims.versionId, email: claims.email, expiresAt: exp * 1000, now });
    await writeAudit(db, {
      actorId: null,
      actorEmail: session.email,
      action: AUDIT.grant,
      targetType: "share",
      targetId: live.share.id,
      metadata: { watermark: claims.watermark },
      now,
    });
    return c.json({
      grant,
      fileType: live.version.fileType,
      filename: live.version.filename,
      watermark: live.share.watermarkEnabled,
      email: session.email,
      download: live.share.downloadAllowed,
      expiresAt: exp * 1000,
    });
  });

  app.post("/api/public/s/:token/events", async (c) => {
    const live = await liveShare(c.req.param("token"));
    const session = await requireViewer(c);
    if (!live || !session || session.shareId !== live.share.id) return c.json(hiddenBody(), 404);
    const parsed = eventSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid" }, 400);
    await recordEvent(db, {
      shareId: live.share.id,
      sessionId: session.id,
      type: parsed.data.type,
      page: parsed.data.page ?? null,
      now: clock.now(),
    });
    return c.json({ ok: true });
  });

  app.get("/api/view/:grant", (c) => serveObject(c, "view"));
  app.get("/api/download/:grant", (c) => serveObject(c, "download"));

  async function serveObject(c: Context, mode: "view" | "download") {
    const grantToken = c.req.param("grant");
    if (!grantToken) return c.json({ error: "invalid_grant" }, 401);
    const claims = await readGrant(grantToken, config.grantSecret, clock.now());
    if (!claims) return c.json({ error: "invalid_grant" }, 401);
    const share = await findShareById(db, claims.shareId);
    if (!share || shareVisibility({ revokedAt: share.revokedAt ?? null, expiresAt: share.expiresAt }, clock.now()) !== "live") {
      return c.json(hiddenBody(), 404);
    }
    const row = await findGrant(db, claims.jti);
    const session = await requireViewer(c);
    const version = await findVersion(db, claims.versionId);
    const allowed =
      row != null &&
      row.expiresAt > clock.now() &&
      session != null &&
      session.id === claims.sessionId &&
      version != null &&
      grantMatchesShare(claims, { id: share.id, documentId: share.documentId, versionId: share.versionId, watermarkEnabled: share.watermarkEnabled }, { id: session.id, email: session.email });
    if (!allowed || !session || !version) return c.json(hiddenBody(), 404);
    const fileType = version.fileType as FileType;
    const decision =
      mode === "download"
        ? downloadDecision({ downloadAllowed: share.downloadAllowed, watermarkEnabled: share.watermarkEnabled, fileType, byteSize: version.byteSize })
        : viewDecision({ watermarkEnabled: share.watermarkEnabled, fileType, byteSize: version.byteSize });
    if (decision === "deny") return c.json({ error: "forbidden" }, 403);
    if (decision === "unstampable") return c.json({ error: "unstampable" }, 403);
    if (decision === "stamp") {
      const full = await storage.get(version.r2Key);
      if (!full) return c.json(hiddenBody(), 404);
      let stamped: Uint8Array;
      try {
        stamped = await stampPdf(full.bytes, session.email);
      } catch {
        return c.json({ error: "unstampable" }, 403);
      }
      const filename = version.filename.replaceAll('"', "");
      let offset = 0;
      let status = 200;
      let body = stamped;
      if (mode === "view" && c.req.header("range")) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(c.req.header("range")?.trim() ?? "");
        if (!match) return c.body(null, 416);
        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : stamped.byteLength - 1;
        if (!Number.isInteger(start) || start < 0 || start >= stamped.byteLength || end < start) return c.body(null, 416);
        offset = start;
        const length = Math.min(end, stamped.byteLength - 1) - start + 1;
        body = stamped.slice(offset, offset + length);
        status = 206;
      }
      if (mode === "view") {
        await recordEvent(db, { shareId: share.id, sessionId: session.id, type: "open", page: null, now: clock.now() });
      } else {
        await writeAudit(db, {
          actorId: null,
          actorEmail: session.email,
          action: AUDIT.download,
          targetType: "document",
          targetId: version.documentId,
          metadata: { watermark: true },
          now: clock.now(),
        });
      }
      const headers = new Headers({
        "content-type": "application/pdf",
        "content-length": String(body.byteLength),
        "accept-ranges": "bytes",
        "content-disposition": `${mode === "download" ? "attachment" : "inline"}; filename="${filename}"`,
      });
      if (status === 206) headers.set("content-range", `bytes ${offset}-${offset + body.byteLength - 1}/${stamped.byteLength}`);
      return new Response(body, { status, headers });
    }
    const probe = await storage.get(version.r2Key, { offset: 0, length: 1 });
    if (!probe) return c.json(hiddenBody(), 404);
    const header = c.req.header("range");
    let offset = 0;
    let length = probe.size;
    let status = 200;
    if (header) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
      if (!match) return c.body(null, 416);
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : probe.size - 1;
      if (!Number.isInteger(start) || start < 0 || start >= probe.size || end < start) return c.body(null, 416);
      offset = start;
      length = Math.min(end, probe.size - 1) - start + 1;
      status = 206;
    }
    const slice = header ? await storage.get(version.r2Key, { offset, length }) : await storage.get(version.r2Key);
    if (!slice) return c.json(hiddenBody(), 404);
    if (mode === "view") {
      await recordEvent(db, { shareId: share.id, sessionId: session.id, type: "open", page: null, now: clock.now() });
    } else {
      await writeAudit(db, {
        actorId: null,
        actorEmail: session.email,
        action: AUDIT.download,
        targetType: "document",
        targetId: version.documentId,
        metadata: { watermark: false },
        now: clock.now(),
      });
    }
    const headers = new Headers({
      "content-type": version.contentType,
      "content-length": String(slice.bytes.byteLength),
      "accept-ranges": "bytes",
      "content-disposition": `${mode === "download" ? "attachment" : "inline"}; filename="${version.filename.replaceAll('"', "")}"`,
    });
    if (status === 206) headers.set("content-range", `bytes ${offset}-${offset + slice.bytes.byteLength - 1}/${probe.size}`);
    return new Response(slice.bytes, { status, headers });
  }

  app.get("/api/admin/retention", async (c) => {
    const user = await requireAdmin(c);
    if (user instanceof Response) return user;
    return c.json({ days: await documentRetentionDays(db) });
  });

  app.patch("/api/admin/retention", async (c) => {
    const user = await requireAdmin(c);
    if (user instanceof Response) return user;
    const parsed = retentionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid" }, 400);
    await setDocumentRetentionDays(db, parsed.data.days);
    await writeAudit(db, {
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT.retention,
      targetType: "retention",
      targetId: "documents",
      metadata: { days: parsed.data.days },
      now: clock.now(),
    });
    return c.json({ days: parsed.data.days });
  });

  app.get("/api/admin/users", async (c) => {
    const user = await requireAdmin(c);
    if (user instanceof Response) return user;
    return c.json({ users: await listUsers(db) });
  });

  app.patch("/api/admin/users/:id", async (c) => {
    const user = await requireAdmin(c);
    if (user instanceof Response) return user;
    if (!canChangeUser(actorOf(user), c.req.param("id"))) return c.json({ error: "forbidden" }, 403);
    const target = await findUserById(db, c.req.param("id"));
    if (!target) return c.json({ error: "not_found" }, 404);
    const parsed = roleChangeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid" }, 400);
    if (parsed.data.role === "member" && target.role === "admin") {
      const admins = (await listUsers(db)).filter((row) => row.role === "admin" && row.disabledAt == null);
      if (admins.length <= 1) return c.json({ error: "forbidden" }, 403);
    }
    const now = clock.now();
    await updateUser(db, target.id, {
      ...(parsed.data.role ? { role: parsed.data.role } : {}),
      ...(parsed.data.disabled === undefined ? {} : { disabledAt: parsed.data.disabled ? now : null }),
    });
    await writeAudit(db, {
      actorId: user.id,
      actorEmail: user.email,
      action: parsed.data.disabled === undefined ? AUDIT.role : AUDIT.disable,
      targetType: "user",
      targetId: target.id,
      metadata: { role: parsed.data.role ?? target.role, disabled: parsed.data.disabled ?? target.disabledAt != null },
      now,
    });
    return c.json({ ok: true });
  });

  app.get("/api/admin/shares", async (c) => {
    const user = await requireAdmin(c);
    if (user instanceof Response) return user;
    const rows = await listAllShares(db);
    const withOpens = [];
    for (const row of rows) withOpens.push({ ...row, opens: await countOpens(db, row.id) });
    return c.json({ shares: withOpens });
  });

  app.get("/api/admin/audit", async (c) => {
    const user = await requireAdmin(c);
    if (user instanceof Response) return user;
    return c.json({ audit: await listAudit(db) });
  });

  app.get("/api/dev/outbox", async (c) => {
    if (config.environment === "production") return c.json({ error: "not_found" }, 404);
    const rows = await listOutbox(db);
    return c.json({
      messages: rows.map((row) => ({ email: row.email, code: row.code, kind: row.kind, shareId: row.shareId, createdAt: row.createdAt })),
    });
  });

  app.all("*", async (c) => {
    if (c.req.path.startsWith("/api") || c.req.path.startsWith("/auth")) return c.json({ error: "not_found" }, 404);
    if (!deps.assets) return c.json({ error: "not_found" }, 404);
    return deps.assets.fetch(c.req.raw);
  });

  return app;
}
