import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

export async function stampPdf(bytes: Uint8Array, email: string): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes);
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const page of document.getPages()) {
    const { height } = page.getSize();
    page.drawText(email, {
      x: 36,
      y: Math.max(36, height / 2),
      size: 16,
      font,
      color: rgb(0.55, 0.12, 0.12),
      opacity: 0.55,
      rotate: degrees(-28),
    });
  }
  document.setSubject(email);
  return document.save({ useObjectStreams: false });
}
