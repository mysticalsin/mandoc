import { unzipSync, strFromU8 } from "fflate";
import type { FileType } from "./files.js";

const MAX_CHARS = 20_000;

export interface OfficePreview {
  kind: "docx" | "pptx" | "xlsx";
  text: string;
}

function decode(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readZip(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) out[name] = strFromU8(data);
  return out;
}

export function previewOffice(bytes: Uint8Array, fileType: FileType): OfficePreview | null {
  if (fileType === "pdf") return null;
  let files: Record<string, string>;
  try {
    files = readZip(bytes);
  } catch {
    return null;
  }
  if (fileType === "docx") {
    const xml = files["word/document.xml"];
    if (!xml) return null;
    return { kind: "docx", text: decode(xml).slice(0, MAX_CHARS) };
  }
  if (fileType === "pptx") {
    const slides = Object.keys(files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const text = slides.map((name, index) => `Slide ${index + 1}. ${decode(files[name] ?? "")}`).join("\n");
    return { kind: "pptx", text: text.slice(0, MAX_CHARS) };
  }
  const shared = files["xl/sharedStrings.xml"] ?? "";
  const strings = [...shared.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((match) => match[1] ?? "");
  const sheet = files["xl/worksheets/sheet1.xml"] ?? "";
  const rows = [...sheet.matchAll(/<c[^>]*>([\s\S]*?)<\/c>/g)].map((cell) => {
    const body = cell[1] ?? "";
    const value = body.match(/<v>([^<]*)<\/v>/)?.[1] ?? "";
    if (body.includes('t="s"') || cell[0].includes('t="s"')) {
      const index = Number(value);
      return strings[index] ?? "";
    }
    return value;
  });
  return { kind: "xlsx", text: rows.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS) };
}
