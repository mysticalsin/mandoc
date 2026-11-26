const FORBIDDEN = /token|secret|password|code|cookie|authorization|otp/i;

export const AUDIT = {
  signIn: "user.sign_in",
  upload: "document.upload",
  delete: "document.delete",
  shareCreate: "share.create",
  shareRevoke: "share.revoke",
  linkView: "share.link_view",
  forward: "share.forward",
  grant: "grant.issue",
  download: "document.download",
  role: "user.role_change",
  disable: "user.disable",
  retention: "retention.run",
  open: "share.open",
} as const;

export type AuditMetadata = Record<string, string | number | boolean | null>;

export function sanitizeAuditMetadata(input: AuditMetadata): AuditMetadata {
  const out: AuditMetadata = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN.test(key)) continue;
    if (typeof value === "string" && (value.length > 200 || FORBIDDEN.test(value))) continue;
    out[key] = value;
  }
  return out;
}
