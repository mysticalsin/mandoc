import { unzipSync, strFromU8, type UnzipFileInfo } from "fflate";
import { MAX_PREVIEW_BYTES, type FileType } from "./files.js";

const MAX_CHARS = 20_000;
/** One OOXML part has to fit in memory. A larger part fails closed. */
export const MAX_PREVIEW_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_SLIDES = 100;
const MAX_ROWS = 100;
const MAX_COLS = 26;
const MAX_BLOCKS = 400;
const DEFAULT_SLIDE_CX = 9_144_000;
const DEFAULT_SLIDE_CY = 6_858_000;

export type DocxBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; rows: string[][] };

export interface SlideBox {
  text: string;
  /** Fractions of the slide, from the top left. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OfficeSheet {
  name: string;
  rows: string[][];
}

export type OfficePreview =
  | { kind: "docx"; text: string; paragraphs: string[]; blocks: DocxBlock[] }
  | { kind: "pptx"; text: string; slides: string[]; frames: { boxes: SlideBox[] }[] }
  | { kind: "xlsx"; text: string; rows: string[][]; sheets: OfficeSheet[] };

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
  if (fileType === "pptx") return name === "ppt/presentation.xml" || /^ppt\/slides\/slide\d+\.xml$/.test(name);
  if (fileType === "xlsx") {
    return name === "xl/sharedStrings.xml" || name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
  }
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
        return kept <= MAX_SLIDES + 4;
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

function tagAt(xml: string, index: number, name: string): boolean {
  if (!xml.startsWith(`<${name}`, index)) return false;
  const next = xml[index + name.length + 1];
  return next === undefined || /[\s>/]/.test(next);
}

function indexOfTag(xml: string, name: string, from: number): number {
  let cursor = from;
  while (cursor < xml.length) {
    const found = xml.indexOf(`<${name}`, cursor);
    if (found < 0) return -1;
    if (tagAt(xml, found, name)) return found;
    cursor = found + name.length + 1;
  }
  return -1;
}

function elementEnd(xml: string, openAt: number, name: string): number {
  const close = xml.indexOf(">", openAt);
  if (close < 0) return -1;
  if (xml[close - 1] === "/") return close + 1;
  let depth = 1;
  let cursor = close + 1;
  const closeToken = `</${name}>`;
  while (cursor < xml.length && depth > 0) {
    const nextOpen = indexOfTag(xml, name, cursor);
    const nextClose = xml.indexOf(closeToken, cursor);
    if (nextClose < 0) return -1;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      const innerClose = xml.indexOf(">", nextOpen);
      if (innerClose < 0) return -1;
      cursor = innerClose + 1;
      if (xml[innerClose - 1] !== "/") depth += 1;
      continue;
    }
    depth -= 1;
    cursor = nextClose + closeToken.length;
    if (depth === 0) return cursor;
  }
  return -1;
}

function paragraphBlock(xml: string): DocxBlock | null {
  const text = tidy(runs(xml, "w:t").join(""));
  if (!text) return null;
  const style = /<w:pStyle\b[^>]*\bw:val="([^"]+)"/.exec(xml)?.[1] ?? "";
  const heading = /^Heading([1-6])$/i.exec(style);
  if (heading) return { kind: "heading", level: Number(heading[1]), text };
  if (style.toLowerCase() === "title") return { kind: "heading", level: 1, text };
  return { kind: "paragraph", text };
}

function tableRows(table: string): string[][] {
  const rows: string[][] = [];
  let cursor = table.indexOf(">") + 1;
  while (cursor > 0 && cursor < table.length && rows.length < MAX_ROWS) {
    const rowAt = indexOfTag(table, "w:tr", cursor);
    if (rowAt < 0) break;
    const rowEnd = elementEnd(table, rowAt, "w:tr");
    if (rowEnd < 0) break;
    const row = table.slice(rowAt, rowEnd);
    const cells: string[] = [];
    let cellCursor = row.indexOf(">") + 1;
    while (cellCursor > 0 && cellCursor < row.length && cells.length < MAX_COLS) {
      const cellAt = indexOfTag(row, "w:tc", cellCursor);
      if (cellAt < 0) break;
      const cellEnd = elementEnd(row, cellAt, "w:tc");
      if (cellEnd < 0) break;
      cells.push(tidy(runs(row.slice(cellAt, cellEnd), "w:t").join(" ")));
      cellCursor = cellEnd;
    }
    rows.push(cells);
    cursor = rowEnd;
  }
  return rows;
}

function docxBlocks(xml: string): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  let cursor = 0;
  while (cursor < xml.length && blocks.length < MAX_BLOCKS) {
    const paragraphAt = indexOfTag(xml, "w:p", cursor);
    const tableAt = indexOfTag(xml, "w:tbl", cursor);
    if (paragraphAt < 0 && tableAt < 0) break;
    if (tableAt >= 0 && (paragraphAt < 0 || tableAt < paragraphAt)) {
      const end = elementEnd(xml, tableAt, "w:tbl");
      if (end < 0) break;
      const rows = tableRows(xml.slice(tableAt, end));
      if (rows.length > 0) blocks.push({ kind: "table", rows });
      cursor = end;
      continue;
    }
    const end = elementEnd(xml, paragraphAt, "w:p");
    if (end < 0) break;
    const block = paragraphBlock(xml.slice(paragraphAt, end));
    if (block) blocks.push(block);
    cursor = end;
  }
  return blocks;
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

function attrNumber(source: string, name: string): number | null {
  const match = new RegExp(`\\b${name}="(-?\\d+(?:\\.\\d+)?)"`).exec(source);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function fraction(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.round((part / whole) * 10_000) / 10_000;
}

function slideSize(xml: string | undefined): { cx: number; cy: number } {
  const tag = xml ? (/<p:sldSz\b([^>]*)\/?>/.exec(xml)?.[1] ?? "") : "";
  const cx = attrNumber(tag, "cx");
  const cy = attrNumber(tag, "cy");
  if (cx == null || cy == null || cx <= 0 || cy <= 0) return { cx: DEFAULT_SLIDE_CX, cy: DEFAULT_SLIDE_CY };
  return { cx, cy };
}

interface GroupFrame {
  x: number;
  y: number;
  cx: number;
  cy: number;
  chx: number;
  chy: number;
  chcx: number;
  chcy: number;
}

function readGroup(group: string): GroupFrame | null {
  const props = /<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/.exec(group)?.[0] ?? "";
  const transform = /<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(props)?.[0] ?? "";
  if (!transform) return null;
  const off = /<a:off\b([^>]*)\/?>/.exec(transform)?.[1] ?? "";
  const ext = /<a:ext\b([^>]*)\/?>/.exec(transform)?.[1] ?? "";
  const childOff = /<a:chOff\b([^>]*)\/?>/.exec(transform)?.[1] ?? "";
  const childExt = /<a:chExt\b([^>]*)\/?>/.exec(transform)?.[1] ?? "";
  const x = attrNumber(off, "x");
  const y = attrNumber(off, "y");
  const cx = attrNumber(ext, "cx");
  const cy = attrNumber(ext, "cy");
  const chx = attrNumber(childOff, "x");
  const chy = attrNumber(childOff, "y");
  const chcx = attrNumber(childExt, "cx");
  const chcy = attrNumber(childExt, "cy");
  if (x == null || y == null || cx == null || cy == null || chx == null || chy == null || chcx == null || chcy == null) return null;
  return { x, y, cx, cy, chx, chy, chcx, chcy };
}

function placeBox(group: GroupFrame | null, x: number, y: number, cx: number, cy: number): { x: number; y: number; cx: number; cy: number } {
  if (!group || group.chcx === 0 || group.chcy === 0) return { x, y, cx, cy };
  const scaleX = group.cx / group.chcx;
  const scaleY = group.cy / group.chcy;
  return { x: group.x + (x - group.chx) * scaleX, y: group.y + (y - group.chy) * scaleY, cx: cx * scaleX, cy: cy * scaleY };
}

function shapeBox(shape: string, size: { cx: number; cy: number }, group: GroupFrame | null): SlideBox | null {
  const text = tidy(runs(shape, "a:t").join(" "));
  if (!text) return null;
  const off = /<a:off\b([^>]*)\/?>/.exec(shape)?.[1] ?? "";
  const ext = /<a:ext\b([^>]*)\/?>/.exec(shape)?.[1] ?? "";
  const x = attrNumber(off, "x");
  const y = attrNumber(off, "y");
  const cx = attrNumber(ext, "cx");
  const cy = attrNumber(ext, "cy");
  if (x == null || y == null || cx == null || cy == null) return { text, x: 0.08, y: 0.08, w: 0.84, h: 0.16 };
  const placed = placeBox(group, x, y, cx, cy);
  return { text, x: fraction(placed.x, size.cx), y: fraction(placed.y, size.cy), w: fraction(placed.cx, size.cx), h: fraction(placed.cy, size.cy) };
}

function collectShapes(xml: string, size: { cx: number; cy: number }, group: GroupFrame | null, out: SlideBox[]) {
  let cursor = 0;
  while (cursor < xml.length && out.length < 200) {
    const shapeAt = indexOfTag(xml, "p:sp", cursor);
    const groupAt = indexOfTag(xml, "p:grpSp", cursor);
    if (shapeAt < 0 && groupAt < 0) break;
    if (groupAt >= 0 && (shapeAt < 0 || groupAt < shapeAt)) {
      const end = elementEnd(xml, groupAt, "p:grpSp");
      if (end < 0) break;
      const body = xml.slice(groupAt, end);
      collectShapes(body.slice(body.indexOf(">") + 1), size, readGroup(body) ?? group, out);
      cursor = end;
      continue;
    }
    const end = elementEnd(xml, shapeAt, "p:sp");
    if (end < 0) break;
    const box = shapeBox(xml.slice(shapeAt, end), size, group);
    if (box) out.push(box);
    cursor = end;
  }
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

function sheetGrid(xml: string, strings: string[]): string[][] {
  const source = xml.includes("</row>") ? xml : `<row>${xml}</row>`;
  const placed = new Map<number, string[]>();
  let maxRow = -1;
  let sequential = 0;
  let used = 0;
  for (const part of source.split("</row>")) {
    if (used >= MAX_CHARS) break;
    const start = part.lastIndexOf("<row");
    if (start < 0) continue;
    const slice = part.slice(start);
    const declared = Number(/\br="(\d+)"/.exec(slice)?.[1] ?? "");
    const rowIndex = Number.isInteger(declared) && declared > 0 ? declared - 1 : sequential;
    sequential = rowIndex + 1;
    if (rowIndex < 0 || rowIndex >= MAX_ROWS) continue;
    const cells: string[] = [];
    let filled = false;
    for (const match of slice.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = match[1] ?? "";
      const ref = /\br="([A-Z]+)\d+"/i.exec(attrs)?.[1] ?? "";
      const index = ref ? columnIndex(ref) : cells.length;
      if (index < 0 || index >= MAX_COLS || used >= MAX_CHARS) continue;
      const value = tidy(cellValue(attrs, match[2] ?? "", strings)).slice(0, MAX_CHARS - used);
      used += value.length;
      while (cells.length < index) cells.push("");
      cells[index] = value;
      if (value) filled = true;
    }
    if (!filled) continue;
    placed.set(rowIndex, cells);
    maxRow = Math.max(maxRow, rowIndex);
  }
  const rows: string[][] = [];
  for (let row = 0; row <= maxRow; row += 1) rows.push(placed.get(row) ?? []);
  return rows;
}

function sheetParts(files: Record<string, string>): { name: string; xml: string }[] {
  const book = files["xl/workbook.xml"];
  const rels = files["xl/_rels/workbook.xml.rels"];
  if (book && rels) {
    const targets = new Map<string, string>();
    for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attrs = match[1] ?? "";
      const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
      if (id && target) targets.set(id, target.replace(/^\//, ""));
    }
    const listed: { name: string; xml: string }[] = [];
    for (const match of book.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const attrs = match[1] ?? "";
      const name = decodeXml(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? "Sheet");
      const id = /\br:id="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const target = targets.get(id);
      const key = target ? (target.startsWith("xl/") ? target : `xl/${target}`) : "";
      const xml = files[key];
      if (!xml) continue;
      listed.push({ name, xml });
    }
    if (listed.length > 0) return listed;
  }
  const xml = files["xl/worksheets/sheet1.xml"];
  return xml ? [{ name: "Sheet", xml }] : [];
}

export function previewOffice(bytes: Uint8Array, fileType: FileType): OfficePreview | null {
  if (fileType === "pdf" || bytes.byteLength > MAX_PREVIEW_BYTES) return null;
  const files = readZip(bytes, fileType);
  if (!files) return null;
  if (fileType === "docx") {
    const xml = files["word/document.xml"];
    if (!xml) return null;
    const blocks = docxBlocks(xml);
    const paragraphs = blocks.length > 0 ? cap(blocks.flatMap((block) => (block.kind === "table" ? [] : [block.text])), MAX_CHARS) : docxParagraphs(xml);
    const laidOut = blocks.length > 0 ? blocks : paragraphs.map((text) => ({ kind: "paragraph" as const, text }));
    if (paragraphs.length === 0) return null;
    return { kind: "docx", paragraphs, blocks: laidOut, text: paragraphs.join("\n") };
  }
  if (fileType === "pptx") {
    const names = Object.keys(files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
      .slice(0, MAX_SLIDES);
    if (names.length === 0) return null;
    const size = slideSize(files["ppt/presentation.xml"]);
    const slides = names.map((name) => slideLines(files[name] ?? ""));
    const frames = names.map((name) => {
      const boxes: SlideBox[] = [];
      collectShapes(files[name] ?? "", size, null, boxes);
      if (boxes.length === 0) {
        const text = slideLines(files[name] ?? "");
        if (text) boxes.push({ text, x: 0.08, y: 0.08, w: 0.84, h: 0.16 });
      }
      return { boxes };
    });
    const text = slides.map((slide, index) => `Slide ${index + 1}. ${slide}`).join("\n").slice(0, MAX_CHARS);
    return { kind: "pptx", slides, frames, text };
  }
  const strings = sharedStrings(files["xl/sharedStrings.xml"] ?? "");
  const sheets = sheetParts(files).map((sheet) => ({ name: sheet.name, rows: sheetGrid(sheet.xml, strings) }));
  const rows = sheets[0]?.rows;
  if (!rows) return null;
  const text = tidy(sheets.flatMap((sheet) => sheet.rows.flat()).join(" ")).slice(0, MAX_CHARS);
  return { kind: "xlsx", rows, sheets, text };
}
