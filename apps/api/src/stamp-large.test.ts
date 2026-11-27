import { stampPdfIncremental } from "@mandoc/core";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

function classicPdf(stream: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    parts.push(bytes);
    cursor += bytes.byteLength;
  };
  const finish = () => {
    const out = new Uint8Array(cursor);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  };
  push("%PDF-1.4\n");
  const obj = (number: number, body: string) => {
    offsets[number] = cursor;
    push(`${number} 0 obj\n${body}\nendobj\n`);
  };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
  obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>");
  offsets[4] = cursor;
  push(`4 0 obj\n<< /Length ${stream.byteLength} >>\nstream\n`);
  push(stream);
  push("\nendstream\nendobj\n");
  obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const xrefAt = cursor;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let number = 1; number <= 5; number += 1) xref += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  push(xref);
  return finish();
}

describe("incremental pdf stamp", () => {
  it("stamps a pdf-lib file and a file above 32 MiB without rewriting the original bytes", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 200]);
    page.drawText("Mandoc sample", { x: 40, y: 100, size: 18, font: await pdf.embedFont(StandardFonts.Helvetica) });
    const original = await pdf.save();
    const stamped = stampPdfIncremental(original, "viewer@example.com");
    expect(stamped).not.toBeNull();
    expect(Buffer.from(stamped!.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    expect(Buffer.from(stamped!).toString("latin1")).toContain("viewer@example.com");
    await PDFDocument.load(stamped!);

    const stream = new Uint8Array(32 * 1024 * 1024 + 8);
    stream.fill(32);
    const large = classicPdf(stream);
    expect(large.byteLength).toBeGreaterThan(32 * 1024 * 1024);
    const largeStamped = stampPdfIncremental(large, "viewer@example.com");
    expect(largeStamped).not.toBeNull();
    expect(Buffer.from(largeStamped!.subarray(0, large.length)).equals(Buffer.from(large))).toBe(true);
    expect(Buffer.from(largeStamped!.subarray(large.length)).toString("latin1")).toContain("viewer@example.com");
  });
});