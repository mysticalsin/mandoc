export const PART_SIZE = 8 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
/**
 * pdf-lib rewrites a PDF in memory. A watermarked PDF larger than this is stamped
 * with an incremental update instead of being refused.
 */
export const PDF_LIB_STAMP_BYTES = 32 * 1024 * 1024;
export const MAX_STAMP_BYTES = PDF_LIB_STAMP_BYTES;
/** Office preview has to hold the package to extract text. Larger files fail closed. */
export const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;

export const FILE_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

export type FileType = keyof typeof FILE_TYPES;

const EXTENSIONS: Record<string, FileType> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
};

export function planPartCount(byteSize: number, partSize = PART_SIZE): number {
  if (byteSize <= 0) return 0;
  return Math.ceil(byteSize / partSize);
}

export function detectFileType(filename: string, contentType: string): FileType | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const byExt = EXTENSIONS[ext];
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const byMime = (Object.entries(FILE_TYPES).find(([, mime]) => mime === normalized)?.[0] ?? null) as FileType | null;
  if (byExt && byMime && byExt !== byMime) return null;
  return byExt ?? byMime;
}

export function safeFilename(filename: string): string | null {
  const base = filename.replaceAll("\\", "/").split("/").pop()?.replace(/[\u0000-\u001f]/g, "").trim() ?? "";
  if (!base || base.length > 200 || base === "." || base === "..") return null;
  return base;
}

export function uploadAllowed(byteSize: number): boolean {
  return Number.isSafeInteger(byteSize) && byteSize > 0 && byteSize <= MAX_UPLOAD_BYTES;
}

export type DownloadDecision = "allow" | "deny" | "stamp" | "unstampable" | "preview";

function stampableSize(byteSize: number): boolean {
  return Number.isSafeInteger(byteSize) && byteSize > 0 && byteSize <= MAX_UPLOAD_BYTES;
}

export function downloadDecision(input: {
  downloadAllowed: boolean;
  watermarkEnabled: boolean;
  fileType: FileType;
  byteSize: number;
}): Exclude<DownloadDecision, "preview"> {
  if (!input.downloadAllowed) return "deny";
  if (!input.watermarkEnabled) return "allow";
  if (!stampableSize(input.byteSize)) return "unstampable";
  return "stamp";
}

/**
 * View never returns the original bytes when a watermark is required.
 * An Office view without a watermark is a text preview, not the package.
 * An Office view with a watermark is a text preview of the stamped package.
 */
export function viewDecision(input: { watermarkEnabled: boolean; fileType: FileType; byteSize: number }): Exclude<DownloadDecision, "deny"> {
  if (!stampableSize(input.byteSize)) return "unstampable";
  if (input.fileType !== "pdf") {
    if (input.watermarkEnabled) return "stamp";
    if (input.byteSize > MAX_PREVIEW_BYTES) return "unstampable";
    return "preview";
  }
  if (!input.watermarkEnabled) return "allow";
  return "stamp";
}
