import {
  abandonedUpload,
  documentDue,
  OUTBOX_TTL_MS,
  randomId,
  sanitizeAuditMetadata,
  STAFF_IDLE_MS,
  type AuditMetadata,
  type FileType,
  type Role,
} from "@mandoc/core";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  auditLog,
  devOutbox,
  documentVersions,
  documents,
  events,
  grants,
  otpChallenges,
  rateLimits,
  retentionPolicies,
  sessions,
  staffDomains,
  shareRecipients,
  shares,
  uploads,
  users,
  viewerSessions,
} from "./schema.js";

export interface UserRecord {
  id: string;
  email: string;
  role: Role;
  disabledAt: number | null;
  createdAt: number;
}

function userOf(row: typeof users.$inferSelect): UserRecord {
  return { id: row.id, email: row.email, role: row.role, disabledAt: row.disabledAt ?? null, createdAt: row.createdAt };
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRecord | null> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ? userOf(rows[0]) : null;
}

export async function findUserById(db: Db, id: string): Promise<UserRecord | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ? userOf(rows[0]) : null;
}

export async function insertUser(db: Db, input: { email: string; role: Role; now: number }): Promise<UserRecord> {
  const row = { id: randomId("usr"), email: input.email, role: input.role, disabledAt: null, createdAt: input.now };
  await db.insert(users).values(row);
  return row;
}

export async function listUsers(db: Db): Promise<UserRecord[]> {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  return rows.map(userOf);
}

export async function updateUser(db: Db, id: string, patch: { role?: Role; disabledAt?: number | null }): Promise<void> {
  const set: { role?: Role; disabledAt?: number | null } = {};
  if (patch.role) set.role = patch.role;
  if (patch.disabledAt !== undefined) set.disabledAt = patch.disabledAt;
  if (Object.keys(set).length === 0) return;
  await db.update(users).set(set).where(eq(users.id, id));
}

export async function insertSession(db: Db, input: { userId: string; tokenHash: string; now: number; expiresAt: number }): Promise<string> {
  const id = randomId("ses");
  await db.insert(sessions).values({
    id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    createdAt: input.now,
    lastSeenAt: input.now,
    expiresAt: input.expiresAt,
  });
  return id;
}

export async function findSessionByHash(db: Db, tokenHash: string) {
  const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  return rows[0] ?? null;
}

export async function touchSession(db: Db, id: string, now: number): Promise<void> {
  await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
}

export async function deleteSessionByHash(db: Db, tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function replaceOtp(
  db: Db,
  input: { purpose: "staff" | "viewer"; email: string; shareId: string | null; codeHash: string; now: number; expiresAt: number },
): Promise<void> {
  await db.delete(otpChallenges).where(and(eq(otpChallenges.purpose, input.purpose), eq(otpChallenges.email, input.email)));
  await db.insert(otpChallenges).values({
    id: randomId("otp"),
    purpose: input.purpose,
    email: input.email,
    shareId: input.shareId,
    codeHash: input.codeHash,
    attempts: 0,
    createdAt: input.now,
    expiresAt: input.expiresAt,
  });
}

export async function findOtp(db: Db, purpose: "staff" | "viewer", email: string, shareId: string | null) {
  const rows = await db
    .select()
    .from(otpChallenges)
    .where(and(eq(otpChallenges.purpose, purpose), eq(otpChallenges.email, email)))
    .orderBy(desc(otpChallenges.createdAt));
  return rows.find((row) => (row.shareId ?? null) === shareId) ?? null;
}

export async function incrementOtpAttempts(db: Db, id: string): Promise<void> {
  await db.update(otpChallenges).set({ attempts: sql`${otpChallenges.attempts} + 1` }).where(eq(otpChallenges.id, id));
}

export async function deleteOtp(db: Db, id: string): Promise<void> {
  await db.delete(otpChallenges).where(eq(otpChallenges.id, id));
}

export async function bumpRate(db: Db, bucket: string, windowMs: number, now: number): Promise<number> {
  const existing = await db.select().from(rateLimits).where(eq(rateLimits.bucket, bucket)).limit(1);
  const row = existing[0];
  if (!row || row.resetAt <= now) {
    await db
      .insert(rateLimits)
      .values({ bucket, count: 1, resetAt: now + windowMs })
      .onConflictDoUpdate({ target: rateLimits.bucket, set: { count: 1, resetAt: now + windowMs } });
    return 1;
  }
  const next = row.count + 1;
  await db.update(rateLimits).set({ count: next }).where(eq(rateLimits.bucket, bucket));
  return next;
}

export async function insertDocumentGraph(
  db: Db,
  input: {
    ownerId: string;
    title: string;
    filename: string;
    contentType: string;
    fileType: FileType;
    byteSize: number;
    partSize: number;
    multipartId: string;
    now: number;
  },
): Promise<{ documentId: string; versionId: string; uploadId: string; r2Key: string }> {
  const documentId = randomId("doc");
  const versionId = randomId("ver");
  const uploadId = randomId("upl");
  const r2Key = `documents/${documentId}/versions/${versionId}`;
  await db.insert(documents).values({
    id: documentId,
    ownerId: input.ownerId,
    title: input.title,
    status: "uploading",
    createdAt: input.now,
    deletedAt: null,
  });
  await db.insert(documentVersions).values({
    id: versionId,
    documentId,
    number: 1,
    r2Key,
    byteSize: input.byteSize,
    contentType: input.contentType,
    fileType: input.fileType,
    filename: input.filename,
    status: "uploading",
    createdAt: input.now,
  });
  await db.insert(uploads).values({
    id: uploadId,
    documentId,
    versionId,
    ownerId: input.ownerId,
    r2Key,
    multipartId: input.multipartId,
    byteSize: input.byteSize,
    partSize: input.partSize,
    receivedParts: "[]",
    status: "uploading",
    createdAt: input.now,
  });
  return { documentId, versionId, uploadId, r2Key };
}

export async function setMultipartId(db: Db, uploadId: string, multipartId: string): Promise<void> {
  await db.update(uploads).set({ multipartId }).where(eq(uploads.id, uploadId));
}

export async function findUpload(db: Db, id: string) {
  const rows = await db.select().from(uploads).where(eq(uploads.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface StoredPart {
  partNumber: number;
  etag: string;
  size: number;
}

export function readParts(json: string): StoredPart[] {
  const parsed = JSON.parse(json) as StoredPart[];
  return Array.isArray(parsed) ? parsed : [];
}

export async function saveUploadPart(db: Db, id: string, parts: StoredPart[]): Promise<void> {
  await db.update(uploads).set({ receivedParts: JSON.stringify(parts) }).where(eq(uploads.id, id));
}

export async function markUploadReady(db: Db, uploadId: string): Promise<void> {
  const upload = await findUpload(db, uploadId);
  if (!upload) return;
  await db.update(uploads).set({ status: "ready" }).where(eq(uploads.id, uploadId));
  await db.update(documentVersions).set({ status: "ready" }).where(eq(documentVersions.id, upload.versionId));
  await db.update(documents).set({ status: "ready" }).where(eq(documents.id, upload.documentId));
}

export async function markUploadFailed(db: Db, uploadId: string): Promise<void> {
  const upload = await findUpload(db, uploadId);
  if (!upload) return;
  await db.update(uploads).set({ status: "failed" }).where(eq(uploads.id, uploadId));
  await db.update(documentVersions).set({ status: "failed" }).where(eq(documentVersions.id, upload.versionId));
  await db.update(documents).set({ status: "failed" }).where(eq(documents.id, upload.documentId));
}

export async function latestReadyVersion(db: Db, documentId: string) {
  const rows = await db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.status, "ready")));
  return rows.sort((a, b) => b.number - a.number)[0] ?? null;
}

export async function findVersion(db: Db, id: string) {
  const rows = await db.select().from(documentVersions).where(eq(documentVersions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findDocument(db: Db, id: string) {
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listLibrary(db: Db, actor: { id: string; role: Role }) {
  const conditions = [eq(documents.status, "ready"), isNull(documents.deletedAt), eq(documentVersions.status, "ready")];
  if (actor.role !== "admin") conditions.push(eq(documents.ownerId, actor.id));
  return db
    .select({
      id: documents.id,
      title: documents.title,
      createdAt: documents.createdAt,
      ownerId: documents.ownerId,
      fileType: documentVersions.fileType,
      byteSize: documentVersions.byteSize,
      filename: documentVersions.filename,
      versionId: documentVersions.id,
    })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(and(...conditions))
    .orderBy(desc(documents.createdAt));
}

function isNull(column: typeof documents.deletedAt) {
  return sql`${column} is null`;
}

export async function softDeleteDocument(db: Db, id: string, now: number): Promise<void> {
  await db.update(documents).set({ deletedAt: now }).where(eq(documents.id, id));
}

export async function insertShare(
  db: Db,
  input: {
    documentId: string;
    versionId: string;
    createdBy: string;
    tokenHash: string;
    sealedToken: string;
    expiresAt: number;
    passwordHash: string | null;
    downloadAllowed: boolean;
    watermarkEnabled: boolean;
    recipients: string[];
    now: number;
  },
): Promise<string> {
  const id = randomId("shr");
  await db.insert(shares).values({
    id,
    documentId: input.documentId,
    versionId: input.versionId,
    createdBy: input.createdBy,
    tokenHash: input.tokenHash,
    sealedToken: input.sealedToken,
    expiresAt: input.expiresAt,
    passwordHash: input.passwordHash,
    downloadAllowed: input.downloadAllowed,
    watermarkEnabled: input.watermarkEnabled,
    revokedAt: null,
    createdAt: input.now,
  });
  for (const email of input.recipients) {
    await db.insert(shareRecipients).values({ id: randomId("rcp"), shareId: id, email });
  }
  return id;
}

export async function findShareByHash(db: Db, tokenHash: string) {
  const rows = await db.select().from(shares).where(eq(shares.tokenHash, tokenHash)).limit(1);
  return rows[0] ?? null;
}

export async function findShareById(db: Db, id: string) {
  const rows = await db.select().from(shares).where(eq(shares.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function shareRecipientsOf(db: Db, shareId: string): Promise<string[]> {
  const rows = await db.select().from(shareRecipients).where(eq(shareRecipients.shareId, shareId));
  return rows.map((row) => row.email);
}

export async function listSharesForDocument(db: Db, documentId: string) {
  return db.select().from(shares).where(eq(shares.documentId, documentId)).orderBy(desc(shares.createdAt));
}

export async function revokeShare(db: Db, id: string, now: number): Promise<void> {
  await db.update(shares).set({ revokedAt: now }).where(eq(shares.id, id));
  await db.delete(grants).where(eq(grants.shareId, id));
}

export async function listAllShares(db: Db) {
  return db
    .select({
      id: shares.id,
      documentId: shares.documentId,
      title: documents.title,
      createdBy: shares.createdBy,
      ownerEmail: users.email,
      expiresAt: shares.expiresAt,
      revokedAt: shares.revokedAt,
      downloadAllowed: shares.downloadAllowed,
      watermarkEnabled: shares.watermarkEnabled,
      createdAt: shares.createdAt,
    })
    .from(shares)
    .innerJoin(documents, eq(documents.id, shares.documentId))
    .innerJoin(users, eq(users.id, shares.createdBy))
    .orderBy(desc(shares.createdAt));
}

export async function insertViewerSession(
  db: Db,
  input: { shareId: string; email: string; tokenHash: string; passwordOk: boolean; now: number; expiresAt: number },
): Promise<string> {
  const id = randomId("vse");
  await db.insert(viewerSessions).values({
    id,
    shareId: input.shareId,
    email: input.email,
    tokenHash: input.tokenHash,
    passwordOk: input.passwordOk,
    createdAt: input.now,
    expiresAt: input.expiresAt,
  });
  return id;
}

export async function findViewerSessionByHash(db: Db, tokenHash: string) {
  const rows = await db.select().from(viewerSessions).where(eq(viewerSessions.tokenHash, tokenHash)).limit(1);
  return rows[0] ?? null;
}

export async function markViewerPassword(db: Db, id: string): Promise<void> {
  await db.update(viewerSessions).set({ passwordOk: true }).where(eq(viewerSessions.id, id));
}

export async function insertGrant(
  db: Db,
  input: { jti: string; shareId: string; sessionId: string; versionId: string; email: string; expiresAt: number; now: number },
): Promise<void> {
  await db.insert(grants).values({
    jti: input.jti,
    shareId: input.shareId,
    sessionId: input.sessionId,
    versionId: input.versionId,
    email: input.email,
    expiresAt: input.expiresAt,
    createdAt: input.now,
  });
}

export async function findGrant(db: Db, jti: string) {
  const rows = await db.select().from(grants).where(eq(grants.jti, jti)).limit(1);
  return rows[0] ?? null;
}

export async function recordEvent(
  db: Db,
  input: { shareId: string; sessionId: string; type: "open" | "page"; page: number | null; now: number },
): Promise<void> {
  if (input.type === "open") {
    const existing = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.sessionId, input.sessionId), eq(events.type, "open")))
      .limit(1);
    if (existing[0]) return;
  }
  await db.insert(events).values({
    id: randomId("evt"),
    shareId: input.shareId,
    sessionId: input.sessionId,
    type: input.type,
    page: input.page,
    createdAt: input.now,
  });
}

export async function countOpens(db: Db, shareId: string): Promise<number> {
  const rows = await db.select({ id: events.id }).from(events).where(and(eq(events.shareId, shareId), eq(events.type, "open")));
  return rows.length;
}

export async function writeAudit(
  db: Db,
  input: {
    actorId: string | null;
    actorEmail: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    metadata: AuditMetadata;
    now: number;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    id: randomId("aud"),
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: JSON.stringify(sanitizeAuditMetadata(input.metadata)),
    createdAt: input.now,
  });
}

function auditRows(rows: { id: string; actorId: string | null; actorEmail: string | null; action: string; targetType: string; targetId: string | null; metadata: string; createdAt: number }[]) {
  return rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) as AuditMetadata }));
}

export async function listAudit(db: Db, limit = 200) {
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
  return auditRows(rows);
}

export async function listAuditExport(db: Db) {
  const rows = await db.select().from(auditLog).orderBy(auditLog.createdAt);
  return auditRows(rows);
}

/** `null` is an unset allowlist. An empty table is unset, not a deny-all. */
export async function listStaffDomains(db: Db): Promise<string[] | null> {
  const rows = await db.select().from(staffDomains).orderBy(staffDomains.domain);
  if (rows.length === 0) return null;
  return rows.map((row) => row.domain);
}

export async function replaceStaffDomains(db: Db, domains: readonly string[]): Promise<void> {
  await db.delete(staffDomains);
  if (domains.length === 0) return;
  await db.insert(staffDomains).values(domains.map((domain) => ({ domain })));
}

export async function insertOutbox(db: Db, input: { kind: string; email: string; code: string; shareId: string | null; now: number }): Promise<void> {
  await db.insert(devOutbox).values({
    id: randomId("box"),
    kind: input.kind,
    email: input.email,
    code: input.code,
    shareId: input.shareId,
    createdAt: input.now,
  });
}

export async function listOutbox(db: Db) {
  return db.select().from(devOutbox).orderBy(sql`rowid desc`).limit(50);
}

export async function documentRetentionDays(db: Db): Promise<number | null> {
  const rows = await db.select().from(retentionPolicies).where(eq(retentionPolicies.scope, "documents")).limit(1);
  return rows[0]?.days ?? null;
}

export async function setDocumentRetentionDays(db: Db, days: number | null): Promise<void> {
  await db.update(retentionPolicies).set({ days }).where(eq(retentionPolicies.scope, "documents"));
}

export async function shareColumns(db: Db): Promise<string[]> {
  const rows = await db.all<{ name: string }>(sql`PRAGMA table_info(shares)`);
  return rows.map((row) => row.name);
}

export async function purgeEphemeral(db: Db, now: number): Promise<{ otp: number; sessions: number; viewers: number; grants: number; outbox: number }> {
  const otp = await db.delete(otpChallenges).where(lte(otpChallenges.expiresAt, now));
  const staff = await db.delete(sessions).where(lte(sessions.expiresAt, now));
  const idle = await db.delete(sessions).where(lte(sessions.lastSeenAt, now - STAFF_IDLE_MS));
  const viewers = await db.delete(viewerSessions).where(lte(viewerSessions.expiresAt, now));
  const grantRows = await db.delete(grants).where(lte(grants.expiresAt, now));
  const outbox = await db.delete(devOutbox).where(lte(devOutbox.createdAt, now - OUTBOX_TTL_MS));
  return {
    otp: changes(otp),
    sessions: changes(staff) + changes(idle),
    viewers: changes(viewers),
    grants: changes(grantRows),
    outbox: changes(outbox),
  };
}

function changes(result: unknown): number {
  if (result && typeof result === "object" && "meta" in result) {
    const meta = result.meta as { changes?: number };
    return meta.changes ?? 0;
  }
  return 0;
}

export async function documentsToPurge(db: Db, now: number): Promise<{ id: string; keys: string[] }[]> {
  const days = await documentRetentionDays(db);
  const docs = await db.select().from(documents);
  const due = docs.filter((doc) => documentDue({ createdAt: doc.createdAt, deletedAt: doc.deletedAt ?? null, days, now }));
  const result = [];
  for (const doc of due) {
    const versions = await db.select().from(documentVersions).where(eq(documentVersions.documentId, doc.id));
    result.push({ id: doc.id, keys: versions.map((version) => version.r2Key) });
  }
  return result;
}

export async function hardDeleteDocument(db: Db, documentId: string): Promise<void> {
  const shareRows = await db.select({ id: shares.id }).from(shares).where(eq(shares.documentId, documentId));
  for (const share of shareRows) {
    await db.delete(events).where(eq(events.shareId, share.id));
    await db.delete(grants).where(eq(grants.shareId, share.id));
    await db.delete(viewerSessions).where(eq(viewerSessions.shareId, share.id));
    await db.delete(shareRecipients).where(eq(shareRecipients.shareId, share.id));
    await db.delete(otpChallenges).where(eq(otpChallenges.shareId, share.id));
  }
  await db.delete(shares).where(eq(shares.documentId, documentId));
  await db.delete(uploads).where(eq(uploads.documentId, documentId));
  await db.delete(documentVersions).where(eq(documentVersions.documentId, documentId));
  await db.delete(documents).where(eq(documents.id, documentId));
}

export async function abandonedUploadIds(db: Db, now: number): Promise<{ uploadId: string; documentId: string; r2Key: string; multipartId: string }[]> {
  const rows = await db.select().from(uploads).where(eq(uploads.status, "uploading"));
  return rows
    .filter((row) => abandonedUpload(row.createdAt, row.status, now))
    .map((row) => ({ uploadId: row.id, documentId: row.documentId, r2Key: row.r2Key, multipartId: row.multipartId }));
}

export async function deleteAbandonedUpload(db: Db, uploadId: string, documentId: string): Promise<void> {
  const doc = await findDocument(db, documentId);
  await db.delete(uploads).where(eq(uploads.id, uploadId));
  if (doc?.status === "uploading") {
    await db.delete(documentVersions).where(eq(documentVersions.documentId, documentId));
    await db.delete(documents).where(eq(documents.id, documentId));
  }
}
