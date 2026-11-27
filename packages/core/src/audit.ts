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
  domains: "staff.domains",
  export: "audit.export",
} as const;

export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditExportRow {
  id: string;
  createdAt: number;
  action: string;
  actorEmail: string | null;
  targetType: string;
  targetId: string | null;
  metadata: AuditMetadata;
}

function csvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  if (/[",\n\r]/.test(cell)) return `"${cell.replaceAll('"', '""')}"`;
  return cell;
}

/** Ledger of audit rows. `createdAt` is the UTC instant the row was written. */
export function auditExportCsv(rows: readonly AuditExportRow[]): string {
  const header = ["id", "createdAt", "action", "actorEmail", "targetType", "targetId", "metadata"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.id),
        csvCell(new Date(row.createdAt).toISOString()),
        csvCell(row.action),
        csvCell(row.actorEmail ?? ""),
        csvCell(row.targetType),
        csvCell(row.targetId ?? ""),
        csvCell(JSON.stringify(row.metadata)),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function sanitizeAuditMetadata(input: AuditMetadata): AuditMetadata {
  const out: AuditMetadata = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN.test(key)) continue;
    if (typeof value === "string" && (value.length > 200 || FORBIDDEN.test(value))) continue;
    out[key] = value;
  }
  return out;
}
