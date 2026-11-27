import { unzipSync, strFromU8, type UnzipFileInfo } from "fflate";
import { MAX_PREVIEW_BYTES, type FileType } from "./files.js";

const MAX_CHARS = 20_000;
/** One OOXML part has to fit in memory. A larger part fails closed. */
export const MAX_PREVIEW_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_SLIDES = 100;
const MAX_ROWS = 100;
const MAX_COLS = 26;

export type OfficePreview =
  | { kind: "docx"; text: string; paragraphs: string[] }
  | { kind: "pptx"; text: string; slides: string[] }
  | { kind: "xlsx"; text: string; rows: string[][] };

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function runs(xml: string, tag: "w:t" | "a:t" | "t"): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g");
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1] ?? ""));
}

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cap(parts: string[], limit: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const part of parts) {
    if (used >= limit) break;
    const next = part.slice(0, limit - used);
    if (!next) break;
    out.push(next);
    used += next.length;
  }
  return out;
}

function wanted(fileType: FileType, name: string): boolean {
  if (fileType === "docx") return name === "word/document.xml";
  if (fileType === "pptx") return /^ppt\/slides\/slide\d+\.xml$/.test(name);
  if (fileType === "xlsx") return name === "xl/sharedStrings.xml" || name === "xl/worksheets/sheet1.xml";
  return false;
}

function readZip(bytes: Uint8Array, fileType: FileType): Record<string, string> | null {
  let overflow = false;
  let kept = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file: UnzipFileInfo) {
        if (!wanted(fileType, file.name)) return false;
        if (file.originalSize > MAX_PREVIEW_ENTRY_BYTES) {
          overflow = true;
          return false;
        }
        kept += 1;
        return kept <= MAX_SLIDES + 2;
      },
    });
  } catch {
    return null;
  }
  if (overflow) return null;
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) out[name] = strFromU8(data);
  return out;
}

function docxParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const part of xml.split("</w:p>")) {
    const start = part.lastIndexOf("<w:p");
    if (start < 0) continue;
    const line = tidy(runs(part.slice(start), "w:t").join(""));
    if (line) paragraphs.push(line);
  }
  if (paragraphs.length > 0) return cap(paragraphs, MAX_CHARS);
  const fallback = tidy(runs(xml, "w:t").join(""));
  return fallback ? cap([fallback], MAX_CHARS) : [];
}

function slideLines(xml: string): string {
  const chunks = xml.includes("</a:p>") ? xml.split("</a:p>") : [xml];
  const lines = chunks.map((part) => tidy(runs(part, "a:t").join(""))).filter(Boolean);
  return cap(lines, MAX_CHARS).join("\n");
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const part of xml.split("</si>")) {
    const start = part.lastIndexOf("<si");
    if (start < 0) continue;
    out.push(runs(part.slice(start), "t").join(""));
  }
  return out;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? "";
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function cellValue(attrs: string, inner: string, strings: string[]): string {
  if (/\bt="s"/.test(attrs)) {
    const id = Number(/<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? "");
    return strings[id] ?? "";
  }
  if (/\bt="inlineStr"/.test(attrs)) return runs(inner, "t").join("");
  if (/\bt="b"/.test(attrs)) return /<v>([^<]*)<\/v>/.exec(inner)?.[1] === "1" ? "TRUE" : "FALSE";
  return decodeXml(/<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? "");
}

function sheetRows(xml: string, strings: string[]): string[][] {
  const source = xml.includes("</row>") ? xml : `<row>${xml}</row>`;
  const rows: string[][] = [];
  let used = 0;
  for (const part of source.split("</row>")) {
    if (rows.length >= MAX_ROWS || used >= MAX_CHARS) break;
    const start = part.lastIndexOf("<row");
    if (start < 0) continue;
    const cells: string[] = [];
    for (const match of part.slice(start).matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = match[1] ?? "";
      const ref = /\br="([A-Z]+)\d+"/i.exec(attrs)?.[1] ?? "";
      const index = ref ? columnIndex(ref) : cells.length;
      if (index < 0 || index >= MAX_COLS || used >= MAX_CHARS) continue;
      const value = tidy(cellValue(attrs, match[2] ?? "", strings)).slice(0, MAX_CHARS - used);
      used += value.length;
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    if (cells.some((cell) => cell !== "")) rows.push(cells);
  }
  return rows;
}

export function previewOffice(bytes: Uint8Array, fileType: FileType): OfficePreview | null {
  if (fileType === "pdf" || bytes.byteLength > MAX_PREVIEW_BYTES) return null;
  const files = readZip(bytes, fileType);
  if (!files) return null;
  if (fileType === "docx") {
    const xml = files["word/document.xml"];
    if (!xml) return null;
    const paragraphs = docxParagraphs(xml);
    return { kind: "docx", paragraphs, text: paragraphs.join("\n") };
  }
  if (fileType === "pptx") {
    const names = Object.keys(files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
      .slice(0, MAX_SLIDES);
    if (names.length === 0) return null;
    const slides = names.map((name) => slideLines(files[name] ?? ""));
    const text = slides.map((slide, index) => `Slide ${index + 1}. ${slide}`).join("\n").slice(0, MAX_CHARS);
    return { kind: "pptx", slides, text };
  }
  const sheet = files["xl/worksheets/sheet1.xml"];
  if (!sheet) return null;
  const rows = sheetRows(sheet, sharedStrings(files["xl/sharedStrings.xml"] ?? ""));
  return { kind: "xlsx", rows, text: tidy(rows.flat().join(" ")).slice(0, MAX_CHARS) };
}
