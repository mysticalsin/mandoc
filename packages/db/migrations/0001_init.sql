CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  disabled_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX users_email_unique ON users (email);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX sessions_token_hash_unique ON sessions (token_hash);

CREATE TABLE otp_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  purpose TEXT NOT NULL,
  email TEXT NOT NULL,
  share_id TEXT,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE document_versions (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  file_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  multipart_id TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  part_size INTEGER NOT NULL,
  received_parts TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  sealed_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  password_hash TEXT,
  download_allowed INTEGER NOT NULL,
  watermark_enabled INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX shares_token_hash_unique ON shares (token_hash);

CREATE TABLE share_recipients (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL,
  email TEXT NOT NULL
);

CREATE TABLE viewer_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  password_ok INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX viewer_sessions_token_hash_unique ON viewer_sessions (token_hash);

CREATE TABLE grants (
  jti TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  share_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  page INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE retention_policies (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  days INTEGER
);
CREATE UNIQUE INDEX retention_policies_scope_unique ON retention_policies (scope);
INSERT INTO retention_policies (id, scope, days) VALUES ('retention_documents', 'documents', NULL);

CREATE TABLE dev_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  share_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
