import { unzlibSync } from "fflate";

interface PdfValue {
  kind: "dict" | "array" | "ref" | "name" | "other";
  raw: string;
  inner: string;
}

interface XEntry {
  type: 0 | 1 | 2;
  offset: number;
  gen: number;
  stream?: number;
  index?: number;
}

interface ParsedPdf {
  root: string;
  xrefOffset: number;
  size: number;
  maxNum: number;
  map: Map<number, XEntry>;
}

function skipSpace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length) {
    if (source[cursor] === "%") {
      while (cursor < source.length && source[cursor] !== "\n") cursor += 1;
      continue;
    }
    if (!/\s/.test(source[cursor] ?? "")) break;
    cursor += 1;
  }
  return cursor;
}

function matchString(source: string, index: number): number {
  let cursor = index + 1;
  let depth = 1;
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === "(") depth += 1;
    else if (source[cursor] === ")") depth -= 1;
    cursor += 1;
  }
  return depth === 0 ? cursor : -1;
}

function matchDict(source: string, index: number): number {
  let cursor = index;
  let depth = 0;
  while (cursor < source.length) {
    if (source[cursor] === "%") {
      while (cursor < source.length && source[cursor] !== "\n") cursor += 1;
      continue;
    }
    if (source[cursor] === "(") {
      const end = matchString(source, cursor);
      if (end < 0) return -1;
      cursor = end;
      continue;
    }
    if (source.startsWith("<<", cursor)) {
      depth += 1;
      cursor += 2;
      continue;
    }
    if (source.startsWith(">>", cursor)) {
      depth -= 1;
      cursor += 2;
      if (depth === 0) return cursor;
      continue;
    }
    if (source[cursor] === "<") {
      const end = source.indexOf(">", cursor + 1);
      if (end < 0) return -1;
      cursor = end + 1;
      continue;
    }
    cursor += 1;
  }
  return -1;
}

function matchArray(source: string, index: number): number {
  let cursor = index;
  let depth = 0;
  while (cursor < source.length) {
    if (source[cursor] === "%") {
      while (cursor < source.length && source[cursor] !== "\n") cursor += 1;
      continue;
    }
    if (source[cursor] === "(") {
      const end = matchString(source, cursor);
      if (end < 0) return -1;
      cursor = end;
      continue;
    }
    if (source.startsWith("<<", cursor)) {
      const end = matchDict(source, cursor);
      if (end < 0) return -1;
      cursor = end;
      continue;
    }
    if (source[cursor] === "<") {
      const end = source.indexOf(">", cursor + 1);
      if (end < 0) return -1;
      cursor = end + 1;
      continue;
    }
    if (source[cursor] === "[") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (source[cursor] === "]") {
      depth -= 1;
      cursor += 1;
      if (depth === 0) return cursor;
      continue;
    }
    cursor += 1;
  }
  return -1;
}

function readValue(source: string, index: number): { end: number; value: PdfValue } | null {
  const start = skipSpace(source, index);
  if (start >= source.length) return null;
  if (source.startsWith("<<", start)) {
    const end = matchDict(source, start);
    if (end < 0) return null;
    return { end, value: { kind: "dict", raw: source.slice(start, end), inner: source.slice(start + 2, end - 2) } };
  }
  if (source[start] === "[") {
    const end = matchArray(source, start);
    if (end < 0) return null;
    return { end, value: { kind: "array", raw: source.slice(start, end), inner: source.slice(start + 1, end - 1) } };
  }
  if (source[start] === "(") {
    const end = matchString(source, start);
    if (end < 0) return null;
    return { end, value: { kind: "other", raw: source.slice(start, end), inner: "" } };
  }
  if (source[start] === "<") {
    const end = source.indexOf(">", start + 1);
    if (end < 0) return null;
    return { end: end + 1, value: { kind: "other", raw: source.slice(start, end + 1), inner: "" } };
  }
  if (source[start] === "/") {
    let cursor = start + 1;
    while (cursor < source.length && !/[\s<>[\]/()]/.test(source[cursor] ?? "")) cursor += 1;
    return { end: cursor, value: { kind: "name", raw: source.slice(start, cursor), inner: "" } };
  }
  const ref = /^(-?\d+)\s+(-?\d+)\s+R\b/.exec(source.slice(start));
  if (ref) return { end: start + ref[0].length, value: { kind: "ref", raw: ref[0], inner: "" } };
  const number = /^-?\d+(?:\.\d+)?/.exec(source.slice(start));
  if (number) return { end: start + number[0].length, value: { kind: "other", raw: number[0], inner: "" } };
  return null;
}

function topValue(dict: string, key: string): PdfValue | null {
  const start = dict.indexOf("<<");
  if (start < 0) return null;
  const end = matchDict(dict, start);
  if (end < 0) return null;
  let cursor = start + 2;
  while (cursor < end - 2) {
    cursor = skipSpace(dict, cursor);
    if (dict[cursor] !== "/") break;
    let nameEnd = cursor + 1;
    while (nameEnd < dict.length && !/[\s<>[\]/()]/.test(dict[nameEnd] ?? "")) nameEnd += 1;
    const name = dict.slice(cursor, nameEnd);
    const read = readValue(dict, nameEnd);
    if (!read) return null;
    if (name === key) return read.value;
    cursor = read.end;
  }
  return null;
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  const from = Math.max(0, start);
  const to = Math.min(bytes.length, end);
  let out = "";
  for (let index = from; index < to; index += 1) out += String.fromCharCode(bytes[index] ?? 0);
  return out;
}

function lastIndexOf(bytes: Uint8Array, needle: string): number {
  const pattern = new TextEncoder().encode(needle);
  outer: for (let index = bytes.length - pattern.length; index >= 0; index -= 1) {
    for (let offset = 0; offset < pattern.length; offset += 1) {
      if (bytes[index + offset] !== pattern[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function readInt(data: Uint8Array, offset: number, width: number): number {
  let value = 0;
  for (let index = 0; index < width; index += 1) value = value * 256 + (data[offset + index] ?? 0);
  return value;
}

function integersOf(raw: string): number[] {
  return (raw.match(/-?\d+/g) ?? []).map((item) => Number(item));
}

function decodeFlate(dict: string, stream: Uint8Array): Uint8Array | null {
  const filter = topValue(dict, "/Filter");
  if (!filter) return stream;
  const name = filter.kind === "array" ? filter.raw : filter.raw;
  if (!name.includes("/FlateDecode") || name.includes("/ASCII") || name.includes("/LZW") || name.includes("/DCT")) return null;
  try {
    const inflated = unzlibSync(stream);
    return applyPredictor(dict, inflated);
  } catch {
    return null;
  }
}

function applyPredictor(dict: string, data: Uint8Array): Uint8Array | null {
  const parms = topValue(dict, "/DecodeParms");
  if (!parms) return data;
  const predictor = Number(topValue(parms.raw, "/Predictor")?.raw ?? "1");
  if (!Number.isFinite(predictor) || predictor <= 1) return data;
  if (predictor < 10) return null;
  const columns = Number(topValue(parms.raw, "/Columns")?.raw ?? "1");
  if (!Number.isInteger(columns) || columns <= 0) return null;
  const rows: Uint8Array[] = [];
  let previous = new Uint8Array(columns);
  let cursor = 0;
  while (cursor < data.length) {
    const algorithm = data[cursor] ?? 0;
    cursor += 1;
    if (cursor + columns > data.length) return null;
    const row = data.slice(cursor, cursor + columns);
    cursor += columns;
    const out = new Uint8Array(columns);
    if (algorithm === 0) out.set(row);
    else if (algorithm === 1) {
      for (let column = 0; column < columns; column += 1) out[column] = (row[column]! + (column > 0 ? out[column - 1]! : 0)) & 255;
    } else if (algorithm === 2) {
      for (let column = 0; column < columns; column += 1) out[column] = (row[column]! + previous[column]!) & 255;
    } else if (algorithm === 3) {
      for (let column = 0; column < columns; column += 1) {
        const left = column > 0 ? out[column - 1]! : 0;
        out[column] = (row[column]! + Math.floor((left + previous[column]!) / 2)) & 255;
      }
    } else if (algorithm === 4) {
      for (let column = 0; column < columns; column += 1) {
        const left = column > 0 ? out[column - 1]! : 0;
        const up = previous[column]!;
        const upLeft = column > 0 ? previous[column - 1]! : 0;
        const estimate = left + up - upLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upLeft);
        const chosen = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        out[column] = (row[column]! + chosen) & 255;
      }
    } else return null;
    previous = out;
    rows.push(out);
  }
  const joined = new Uint8Array(rows.reduce((sum, row) => sum + row.length, 0));
  let offset = 0;
  for (const row of rows) {
    joined.set(row, offset);
    offset += row.length;
  }
  return joined;
}

function readObject(bytes: Uint8Array, offset: number): { num: number; gen: number; body: string; stream: Uint8Array | null } | null {
  const head = latin1(bytes, offset, offset + 48);
  const match = /^\s*(\d+)\s+(\d+)\s+obj\b/.exec(head);
  if (!match) return null;
  const window = latin1(bytes, offset, Math.min(bytes.length, offset + 250_000));
  const dictAt = window.indexOf("<<", match[0].length);
  if (dictAt < 0) return null;
  const dictEnd = matchDict(window, dictAt);
  if (dictEnd < 0) return null;
  const body = window.slice(dictAt, dictEnd);
  let stream: Uint8Array | null = null;
  if (/^\s*stream\b/.test(window.slice(dictEnd, dictEnd + 20))) {
    const length = topValue(body, "/Length");
    if (!length || length.kind !== "other") return null;
    const size = Number(length.raw);
    if (!Number.isInteger(size) || size < 0) return null;
    const token = window.indexOf("stream", dictEnd);
    let dataAt = offset + token + "stream".length;
    if (bytes[dataAt] === 13) dataAt += 1;
    if (bytes[dataAt] === 10) dataAt += 1;
    stream = bytes.slice(dataAt, dataAt + size);
  }
  return { num: Number(match[1]), gen: Number(match[2]), body, stream };
}

function remember(map: Map<number, XEntry>, objectNumber: number, entry: XEntry) {
  if (!map.has(objectNumber)) map.set(objectNumber, entry);
}

function takeTrailer(dict: string, trailer: { root: string; prev: number | null; size: number; encrypt: boolean }) {
  const root = topValue(dict, "/Root");
  if (!trailer.root && root?.kind === "ref") trailer.root = root.raw;
  const prev = topValue(dict, "/Prev");
  if (trailer.prev == null && prev?.kind === "other") trailer.prev = Number(prev.raw);
  const size = topValue(dict, "/Size");
  if (size?.kind === "other") trailer.size = Math.max(trailer.size, Number(size.raw));
  if (topValue(dict, "/Encrypt")) trailer.encrypt = true;
}

function parseClassicXref(text: string, map: Map<number, XEntry>, trailer: { root: string; prev: number | null; size: number; encrypt: boolean }): boolean {
  let cursor = skipSpace(text, text.startsWith("xref") ? 4 : 0);
  while (cursor < text.length) {
    cursor = skipSpace(text, cursor);
    if (text.startsWith("trailer", cursor)) {
      const dictAt = text.indexOf("<<", cursor);
      if (dictAt < 0) return false;
      const dictEnd = matchDict(text, dictAt);
      if (dictEnd < 0) return false;
      takeTrailer(text.slice(dictAt, dictEnd), trailer);
      return Boolean(trailer.root);
    }
    const header = /^(\d+)\s+(\d+)/.exec(text.slice(cursor));
    if (!header) return false;
    let objectNumber = Number(header[1]);
    const count = Number(header[2]);
    cursor += header[0].length;
    for (let index = 0; index < count; index += 1) {
      const line = /\s*(\d{1,10})\s+(\d{1,5})\s+([nf])/.exec(text.slice(cursor));
      if (!line) return false;
      remember(map, objectNumber, {
        type: line[3] === "n" ? 1 : 0,
        offset: Number(line[1]),
        gen: Number(line[2]),
      });
      objectNumber += 1;
      cursor += line[0].length;
    }
  }
  return false;
}

function parseXrefStream(bytes: Uint8Array, offset: number, map: Map<number, XEntry>, trailer: { root: string; prev: number | null; size: number; encrypt: boolean }): boolean {
  const object = readObject(bytes, offset);
  if (!object?.stream) return false;
  takeTrailer(object.body, trailer);
  const widths = integersOf(topValue(object.body, "/W")?.raw ?? "");
  if (widths.length < 3) return false;
  const size = Number(topValue(object.body, "/Size")?.raw ?? "0");
  const index = integersOf(topValue(object.body, "/Index")?.raw ?? "") ;
  const ranges = index.length >= 2 ? index : [0, size];
  const data = decodeFlate(object.body, object.stream);
  if (!data) return false;
  const width = widths[0]! + widths[1]! + widths[2]!;
  let cursor = 0;
  for (let pair = 0; pair + 1 < ranges.length; pair += 2) {
    let objectNumber = ranges[pair] ?? 0;
    const count = ranges[pair + 1] ?? 0;
    for (let entry = 0; entry < count; entry += 1) {
      if (cursor + width > data.length) return false;
      const type = widths[0] === 0 ? 1 : readInt(data, cursor, widths[0]!);
      const field2 = readInt(data, cursor + widths[0]!, widths[1]!);
      const field3 = readInt(data, cursor + widths[0]! + widths[1]!, widths[2]!);
      cursor += width;
      if (type === 0) remember(map, objectNumber, { type: 0, offset: 0, gen: field3 });
      else if (type === 1) remember(map, objectNumber, { type: 1, offset: field2, gen: field3 });
      else if (type === 2) remember(map, objectNumber, { type: 2, offset: 0, gen: 0, stream: field2, index: field3 });
      objectNumber += 1;
    }
  }
  return Boolean(trailer.root);
}

function parseXref(bytes: Uint8Array, offset: number, map: Map<number, XEntry>, trailer: { root: string; prev: number | null; size: number; encrypt: boolean }): boolean {
  const head = latin1(bytes, offset, offset + 16);
  if (/^\s*xref\b/.test(head)) {
    const text = latin1(bytes, offset, Math.min(bytes.length, offset + 8_000_000));
    return parseClassicXref(text, map, trailer);
  }
  return parseXrefStream(bytes, offset, map, trailer);
}

function parsePdf(bytes: Uint8Array): ParsedPdf | null {
  const marker = lastIndexOf(bytes, "startxref");
  if (marker < 0) return null;
  const tail = latin1(bytes, marker, Math.min(bytes.length, marker + 64));
  const start = /startxref\s+(\d+)/.exec(tail);
  if (!start) return null;
  const map = new Map<number, XEntry>();
  const trailer = { root: "", prev: null as number | null, size: 0, encrypt: false };
  let offset = Number(start[1]);
  const first = offset;
  const seen = new Set<number>();
  while (!seen.has(offset)) {
    seen.add(offset);
    const before = trailer.prev;
    if (!parseXref(bytes, offset, map, trailer)) return null;
    if (trailer.encrypt) return null;
    if (trailer.prev == null || trailer.prev === before) break;
    offset = trailer.prev;
  }
  if (!trailer.root) return null;
  let maxNum = 0;
  for (const number of map.keys()) maxNum = Math.max(maxNum, number);
  return { root: trailer.root, xrefOffset: first, size: Math.max(trailer.size, maxNum + 1), maxNum, map };
}

function objectStreamBodies(bytes: Uint8Array, map: Map<number, XEntry>, streamNumber: number, cache: Map<number, Map<number, string>>): Map<number, string> | null {
  const cached = cache.get(streamNumber);
  if (cached) return cached;
  const entry = map.get(streamNumber);
  if (!entry || entry.type !== 1) return null;
  const object = readObject(bytes, entry.offset);
  if (!object?.stream || topValue(object.body, "/Type")?.raw !== "/ObjStm") return null;
  const count = Number(topValue(object.body, "/N")?.raw);
  const first = Number(topValue(object.body, "/First")?.raw);
  if (!Number.isInteger(count) || !Number.isInteger(first) || count < 0 || first < 0) return null;
  const data = decodeFlate(object.body, object.stream);
  if (!data) return null;
  const header = latin1(data, 0, first).trim().split(/\s+/);
  const bodies = new Map<number, string>();
  for (let index = 0; index < count; index += 1) {
    const objectNumber = Number(header[index * 2]);
    const start = first + Number(header[index * 2 + 1]);
    const end = index + 1 < count ? first + Number(header[(index + 1) * 2 + 1]) : data.length;
    if (!Number.isInteger(objectNumber) || !Number.isInteger(start) || !Number.isInteger(end) || end < start) return null;
    bodies.set(objectNumber, latin1(data, start, end));
  }
  cache.set(streamNumber, bodies);
  return bodies;
}

function loadBody(bytes: Uint8Array, map: Map<number, XEntry>, objectNumber: number, cache: Map<number, Map<number, string>>): string | null {
  const entry = map.get(objectNumber);
  if (!entry || entry.type === 0) return null;
  if (entry.type === 1) return readObject(bytes, entry.offset)?.body ?? null;
  if (entry.stream == null || entry.index == null) return null;
  const bodies = objectStreamBodies(bytes, map, entry.stream, cache);
  return bodies?.get(objectNumber) ?? null;
}

function refsIn(raw: string): number[] {
  return [...raw.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]));
}

function collectPages(bytes: Uint8Array, parsed: ParsedPdf): { num: number; body: string }[] {
  const rootRef = /^(\d+)\s+\d+\s+R$/.exec(parsed.root.trim());
  if (!rootRef) return [];
  const cache = new Map<number, Map<number, string>>();
  const catalog = loadBody(bytes, parsed.map, Number(rootRef[1]), cache);
  const pagesRef = catalog ? topValue(catalog, "/Pages") : null;
  const start = pagesRef?.kind === "ref" ? Number(/^(\d+)/.exec(pagesRef.raw)?.[1]) : Number.NaN;
  if (!Number.isInteger(start)) return [];
  const pages: { num: number; body: string }[] = [];
  const seen = new Set<number>();
  function walk(objectNumber: number) {
    if (seen.has(objectNumber)) return;
    seen.add(objectNumber);
    const body = loadBody(bytes, parsed.map, objectNumber, cache);
    if (!body) return;
    const kids = topValue(body, "/Kids");
    if (kids?.kind === "array") {
      for (const child of refsIn(kids.raw)) walk(child);
      return;
    }
    const type = topValue(body, "/Type")?.raw;
    if (type === "/Page" || topValue(body, "/Contents") || topValue(body, "/MediaBox")) pages.push({ num: objectNumber, body });
  }
  walk(start);
  return pages;
}

function replaceRaw(page: string, current: string, next: string): string | null {
  const index = page.indexOf(current);
  if (index < 0 || page.indexOf(current, index + current.length) >= 0) return null;
  return `${page.slice(0, index)}${next}${page.slice(index + current.length)}`;
}

function rewritePage(page: string, fontRef: string, contentRef: string): string | null {
  let body = page;
  const resources = topValue(body, "/Resources");
  if (!resources) {
    const end = matchDict(body, body.indexOf("<<"));
    if (end < 0) return null;
    body = `${body.slice(0, end - 2)} /Resources << /Font << /MandocF ${fontRef} >> >> ${body.slice(end - 2)}`;
  } else if (resources.kind === "dict") {
    const font = topValue(resources.raw, "/Font");
    if (!font) {
      const next = resources.raw.replace("<<", `<< /Font << /MandocF ${fontRef} >> `);
      const replaced = replaceRaw(body, resources.raw, next);
      if (!replaced) return null;
      body = replaced;
    } else if (font.kind === "dict") {
      const nextFont = font.raw.replace("<<", `<< /MandocF ${fontRef} `);
      const nextResources = replaceRaw(resources.raw, font.raw, nextFont);
      if (!nextResources) return null;
      const replaced = replaceRaw(body, resources.raw, nextResources);
      if (!replaced) return null;
      body = replaced;
    } else return null;
  } else return null;

  const contents = topValue(body, "/Contents");
  if (!contents) {
    const end = matchDict(body, body.indexOf("<<"));
    if (end < 0) return null;
    return `${body.slice(0, end - 2)} /Contents ${contentRef} ${body.slice(end - 2)}`;
  }
  if (contents.kind === "array") {
    const next = contents.raw.replace(/\]$/, ` ${contentRef}]`);
    return replaceRaw(body, contents.raw, next);
  }
  if (contents.kind === "ref") return replaceRaw(body, contents.raw, `[ ${contents.raw} ${contentRef} ]`);
  return null;
}

function mediaHeight(body: string): number {
  const box = topValue(body, "/MediaBox");
  const numbers = box ? integersOf(box.raw) : [];
  if (numbers.length < 4) return 792;
  return Math.max(72, (numbers[3] ?? 792) - (numbers[1] ?? 0));
}

function pdfLiteral(email: string): string | null {
  let literal = "(";
  for (const char of email) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) return null;
    if (char === "\\" || char === "(" || char === ")") literal += `\\${char}`;
    else literal += char;
  }
  return `${literal})`;
}

function stampStream(email: string, y: number): string | null {
  const literal = pdfLiteral(email);
  if (!literal) return null;
  const content = `q\nBT\n/MandocF 18 Tf\n0.55 0.12 0.12 rg\n0.88 -0.47 0.47 0.88 72 ${Math.round(y)} Tm\n${literal} Tj\nET\nQ\n`;
  return `<< /Length ${content.length} >>\nstream\n${content}endstream`;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Appends a page stamp without rewriting the original streams. Null refuses the file. */
export function stampPdfIncremental(bytes: Uint8Array, email: string): Uint8Array | null {
  if (!email || email.length > 320 || /[\u0000-\u001f]/.test(email)) return null;
  const parsed = parsePdf(bytes);
  if (!parsed) return null;
  const pages = collectPages(bytes, parsed);
  if (pages.length === 0) return null;
  let next = parsed.maxNum + 1;
  const fontNum = next;
  next += 1;
  const objects: { num: number; body: string }[] = [{ num: fontNum, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" }];
  for (const page of pages) {
    const contentNum = next;
    next += 1;
    const stream = stampStream(email, mediaHeight(page.body) / 2);
    const rewritten = stream ? rewritePage(page.body.trim(), `${fontNum} 0 R`, `${contentNum} 0 R`) : null;
    if (!stream || !rewritten) return null;
    objects.push({ num: contentNum, body: stream });
    objects.push({ num: page.num, body: rewritten.trim() });
  }
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [bytes];
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 10) parts.push(encoder.encode("\n"));
  let cursor = parts.reduce((sum, part) => sum + part.length, 0);
  const placed: { num: number; offset: number }[] = [];
  for (const object of objects) {
    const text = `${object.num} 0 obj\n${object.body}\nendobj\n`;
    placed.push({ num: object.num, offset: cursor });
    const bin = encoder.encode(text);
    parts.push(bin);
    cursor += bin.length;
  }
  placed.sort((a, b) => a.num - b.num);
  const xrefAt = cursor;
  let xref = "xref\n";
  let index = 0;
  while (index < placed.length) {
    let end = index + 1;
    while (end < placed.length && placed[end]!.num === placed[end - 1]!.num + 1) end += 1;
    xref += `${placed[index]!.num} ${end - index}\n`;
    for (let cursorIndex = index; cursorIndex < end; cursorIndex += 1) {
      xref += `${String(placed[cursorIndex]!.offset).padStart(10, "0")} 00000 n \n`;
    }
    index = end;
  }
  const size = Math.max(parsed.size, ...objects.map((object) => object.num + 1));
  xref += `trailer\n<< /Size ${size} /Prev ${parsed.xrefOffset} /Root ${parsed.root} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(encoder.encode(xref));
  return concat(parts);
}
