import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    disabledAt: integer("disabled_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "number" }).notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash)],
);

export const otpChallenges = sqliteTable("otp_challenges", {
  id: text("id").primaryKey(),
  purpose: text("purpose", { enum: ["staff", "viewer"] }).notNull(),
  email: text("email").notNull(),
  shareId: text("share_id"),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts", { mode: "number" }).notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  expiresAt: integer("expires_at", { mode: "number" }).notNull(),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["uploading", "ready", "failed"] }).notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "number" }),
});

export const documentVersions = sqliteTable("document_versions", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  number: integer("number", { mode: "number" }).notNull(),
  r2Key: text("r2_key").notNull(),
  byteSize: integer("byte_size", { mode: "number" }).notNull(),
  contentType: text("content_type").notNull(),
  fileType: text("file_type", { enum: ["pdf", "docx", "pptx", "xlsx"] }).notNull(),
  filename: text("filename").notNull(),
  status: text("status", { enum: ["uploading", "ready", "failed"] }).notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  versionId: text("version_id").notNull(),
  ownerId: text("owner_id").notNull(),
  r2Key: text("r2_key").notNull(),
  multipartId: text("multipart_id").notNull(),
  byteSize: integer("byte_size", { mode: "number" }).notNull(),
  partSize: integer("part_size", { mode: "number" }).notNull(),
  receivedParts: text("received_parts").notNull(),
  status: text("status", { enum: ["uploading", "ready", "failed"] }).notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const shares = sqliteTable(
  "shares",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    createdBy: text("created_by").notNull(),
    tokenHash: text("token_hash").notNull(),
    sealedToken: text("sealed_token").notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    passwordHash: text("password_hash"),
    downloadAllowed: integer("download_allowed", { mode: "boolean" }).notNull(),
    watermarkEnabled: integer("watermark_enabled", { mode: "boolean" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("shares_token_hash_unique").on(table.tokenHash)],
);

export const shareRecipients = sqliteTable("share_recipients", {
  id: text("id").primaryKey(),
  shareId: text("share_id").notNull(),
  email: text("email").notNull(),
});

export const viewerSessions = sqliteTable(
  "viewer_sessions",
  {
    id: text("id").primaryKey(),
    shareId: text("share_id").notNull(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    passwordOk: integer("password_ok", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("viewer_sessions_token_hash_unique").on(table.tokenHash)],
);

export const grants = sqliteTable("grants", {
  jti: text("jti").primaryKey(),
  shareId: text("share_id").notNull(),
  sessionId: text("session_id").notNull(),
  versionId: text("version_id").notNull(),
  email: text("email").notNull(),
  expiresAt: integer("expires_at", { mode: "number" }).notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  shareId: text("share_id").notNull(),
  sessionId: text("session_id").notNull(),
  type: text("type", { enum: ["open", "page"] }).notNull(),
  page: integer("page", { mode: "number" }),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  metadata: text("metadata").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

/** `days` stays null until an owner sets a document lifetime. */
export const retentionPolicies = sqliteTable("retention_policies", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  days: integer("days", { mode: "number" }),
});

/** Empty means the owner has not set a staff sign-in allowlist. */
export const staffDomains = sqliteTable("staff_domains", {
  domain: text("domain").primaryKey(),
});

export const devOutbox = sqliteTable("dev_outbox", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  email: text("email").notNull(),
  code: text("code").notNull(),
  shareId: text("share_id"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const rateLimits = sqliteTable("rate_limits", {
  bucket: text("bucket").primaryKey(),
  count: integer("count", { mode: "number" }).notNull(),
  resetAt: integer("reset_at", { mode: "number" }).notNull(),
});
