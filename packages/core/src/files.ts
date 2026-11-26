export const PART_SIZE = 8 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
/** pdf-lib has to hold the file to stamp a download. Larger PDFs fail closed. */
export const MAX_STAMP_BYTES = 32 * 1024 * 1024;

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

export type DownloadDecision = "allow" | "deny" | "stamp" | "unstampable";

export function downloadDecision(input: {
  downloadAllowed: boolean;
  watermarkEnabled: boolean;
  fileType: FileType;
  byteSize: number;
}): DownloadDecision {
  if (!input.downloadAllowed) return "deny";
  if (!input.watermarkEnabled) return "allow";
  if (input.fileType !== "pdf") return "unstampable";
  if (input.byteSize > MAX_STAMP_BYTES) return "unstampable";
  return "stamp";
}
