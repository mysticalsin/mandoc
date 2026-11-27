import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  canChangeUser,
  canReadDocument,
  csrfAllows,
  documentDue,
  downloadDecision,
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_ENTRY_BYTES,
  viewDecision,
  expiryAllowed,
  generateOtpCode,
  grantMatchesShare,
  hashOtp,
  hashPassword,
  hiddenBody,
  hmacHex,
  newShareToken,
  openSecret,
  otpMatches,
  otpStillValid,
  planPartCount,
  auditExportCsv,
  normalizeStaffDomains,
  previewOffice,
  staffSignInAllowed,
  stampOffice,
  readGrant,
  sanitizeAuditMetadata,
  sealSecret,
  securityHeaders,
  shareTokenHash,
  shareVisibility,
  signGrant,
  staffSessionLive,
  timingSafeEqual,
  verifyPassword,
  PART_SIZE,
} from "./index.js";

const secret = "test-grant-secret";

describe("share tokens", () => {
  it("stores a hash, not the token", async () => {
    const token = newShareToken();
    const hash = await shareTokenHash(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(await shareTokenHash(token)).toBe(hash);
  });

  it("seals a copy the creator can open", async () => {
    const token = newShareToken();
    const sealed = await sealSecret(token, "share-link-key");
    expect(sealed).not.toContain(token);
    expect(await openSecret(sealed, "share-link-key")).toBe(token);
  });

  it("hides unknown, revoked, and expired the same way", () => {
    const now = 1_000_000;
    expect(shareVisibility(null, now)).toBe("hidden");
    expect(shareVisibility({ revokedAt: now - 1, expiresAt: now + 10_000 }, now)).toBe("hidden");
    expect(shareVisibility({ revokedAt: null, expiresAt: now }, now)).toBe("hidden");
    expect(shareVisibility({ revokedAt: null, expiresAt: now + 1 }, now)).toBe("live");
    expect(hiddenBody()).toEqual({ error: "not_found" });
  });

  it("rejects an expiry that is already due or a year out", () => {
    const now = 1_000_000;
    expect(expiryAllowed(now + 4 * 60 * 1000, now)).toBe(false);
    expect(expiryAllowed(now + 60 * 60 * 1000, now)).toBe(true);
    expect(expiryAllowed(now + 400 * 24 * 60 * 60 * 1000, now)).toBe(false);
  });
});

describe("grants", () => {
  const claims = {
    v: 1 as const,
    jti: "grant_1",
    shareId: "share_1",
    documentId: "doc_1",
    versionId: "ver_1",
    sessionId: "ses_1",
    email: "viewer@example.com",
    exp: 2_000,
    watermark: true,
  };

  it("rejects an expired grant and a forged grant", async () => {
    const token = await signGrant(claims, secret);
    expect(await readGrant(token, secret, claims.exp * 1000 - 1)).toMatchObject({ jti: "grant_1" });
    expect(await readGrant(token, secret, claims.exp * 1000)).toBeNull();
    const forged = `${token.slice(0, -2)}aa`;
    expect(await readGrant(forged, secret, 0)).toBeNull();
    expect(await readGrant(token, "other-secret", 0)).toBeNull();
  });

  it("fails closed when the claim disagrees with the share", () => {
    const share = { id: "share_1", documentId: "doc_1", versionId: "ver_1", watermarkEnabled: true };
    const session = { id: "ses_1", email: "viewer@example.com" };
    expect(grantMatchesShare(claims, share, session)).toBe(true);
    expect(grantMatchesShare({ ...claims, watermark: false }, share, session)).toBe(false);
    expect(grantMatchesShare({ ...claims, shareId: "share_2" }, share, session)).toBe(false);
    expect(grantMatchesShare(claims, share, { ...session, email: "other@example.com" })).toBe(false);
  });
});

describe("otp and passwords", () => {
  it("rejects a wrong code and an exhausted code", async () => {
    const code = generateOtpCode();
    expect(code).toMatch(/^\d{6}$/);
    const pepper = "otp-pepper";
    const stored = await hashOtp(code, pepper);
    expect(otpMatches(await hashOtp("000000" === code ? "000001" : "000000", pepper), stored)).toBe(false);
    expect(otpMatches(await hashOtp(code, pepper), stored)).toBe(true);
    expect(otpStillValid({ expiresAt: 10, attempts: 5, now: 1 })).toBe(false);
    expect(otpStillValid({ expiresAt: 10, attempts: 4, now: 11 })).toBe(false);
    expect(otpStillValid({ expiresAt: 10, attempts: 0, now: 9 })).toBe(true);
  });

  it("checks passwords in constant time", async () => {
    const stored = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horse", stored)).toBe(true);
    expect(await verifyPassword("wrong-horse", stored)).toBe(false);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(await hmacHex("a", "b")).toHaveLength(64);
  });
});

describe("authz", () => {
  const admin = { id: "u1", email: "ada@example.com", role: "admin" as const, disabledAt: null };
  const member = { id: "u2", email: "bea@example.com", role: "member" as const, disabledAt: null };
  const doc = { ownerId: "u2", deletedAt: null };

  it("scopes documents to the owner unless the caller is an admin", () => {
    expect(canReadDocument(member, doc)).toBe(true);
    expect(canReadDocument(member, { ownerId: "u1", deletedAt: null })).toBe(false);
    expect(canReadDocument(admin, { ownerId: "u9", deletedAt: null })).toBe(true);
    expect(canReadDocument({ ...member, disabledAt: 1 }, doc)).toBe(false);
    expect(canReadDocument(member, { ...doc, deletedAt: 1 })).toBe(false);
  });

  it("blocks privilege changes against yourself and from a member", () => {
    expect(canChangeUser(member, "u1")).toBe(false);
    expect(canChangeUser(admin, admin.id)).toBe(false);
    expect(canChangeUser(admin, "u2")).toBe(true);
  });
});

describe("http and download gate", () => {
  it("fails closed on a missing CSRF header or a foreign origin", () => {
    expect(csrfAllows({ method: "GET", origin: null, appOrigin: "http://127.0.0.1:8791", requestHeader: null })).toBe(true);
    expect(csrfAllows({ method: "POST", origin: "http://127.0.0.1:8791", appOrigin: "http://127.0.0.1:8791", requestHeader: null })).toBe(false);
    expect(csrfAllows({ method: "POST", origin: "https://evil.test", appOrigin: "http://127.0.0.1:8791", requestHeader: "1" })).toBe(false);
    expect(csrfAllows({ method: "POST", origin: "http://127.0.0.1:8791", appOrigin: "http://127.0.0.1:8791", requestHeader: "1" })).toBe(true);
  });

  it("sends HSTS only on https", () => {
    expect(securityHeaders(false)["strict-transport-security"]).toBeUndefined();
    expect(securityHeaders(true)["strict-transport-security"]).toContain("max-age=");
    expect(securityHeaders(true)["content-security-policy"]).toContain("script-src 'self'");
    expect(securityHeaders(true)["x-frame-options"]).toBe("DENY");
  });

  it("denies download unless the share allows it, and stamps watermarked PDFs", () => {
    expect(downloadDecision({ downloadAllowed: false, watermarkEnabled: false, fileType: "pdf", byteSize: 10 })).toBe("deny");
    expect(downloadDecision({ downloadAllowed: true, watermarkEnabled: false, fileType: "docx", byteSize: 10 })).toBe("allow");
    expect(downloadDecision({ downloadAllowed: true, watermarkEnabled: true, fileType: "pdf", byteSize: 10 })).toBe("stamp");
    expect(downloadDecision({ downloadAllowed: true, watermarkEnabled: true, fileType: "pptx", byteSize: 10 })).toBe("stamp");
    expect(downloadDecision({ downloadAllowed: true, watermarkEnabled: true, fileType: "docx", byteSize: 10 })).toBe("stamp");
    expect(downloadDecision({ downloadAllowed: true, watermarkEnabled: true, fileType: "xlsx", byteSize: 33 * 1024 * 1024 })).toBe("stamp");
    expect(downloadDecision({ downloadAllowed: true, watermarkEnabled: true, fileType: "pdf", byteSize: 32 * 1024 * 1024 + 1 })).toBe("stamp");
    expect(downloadDecision({ downloadAllowed: false, watermarkEnabled: false, fileType: "xlsx", byteSize: 10 })).toBe("deny");
    expect(viewDecision({ watermarkEnabled: true, fileType: "pdf", byteSize: 10 })).toBe("stamp");
    expect(viewDecision({ watermarkEnabled: true, fileType: "pdf", byteSize: 32 * 1024 * 1024 + 1 })).toBe("stamp");
    expect(viewDecision({ watermarkEnabled: true, fileType: "docx", byteSize: 10 })).toBe("stamp");
    expect(viewDecision({ watermarkEnabled: false, fileType: "pdf", byteSize: 10 })).toBe("allow");
    expect(viewDecision({ watermarkEnabled: false, fileType: "docx", byteSize: 10 })).toBe("preview");
    expect(viewDecision({ watermarkEnabled: false, fileType: "pptx", byteSize: MAX_PREVIEW_BYTES })).toBe("preview");
    expect(viewDecision({ watermarkEnabled: false, fileType: "xlsx", byteSize: MAX_PREVIEW_BYTES + 1 })).toBe("unstampable");
  });
});

describe("retention and audit", () => {
  it("does not invent a document lifetime", () => {
    expect(documentDue({ createdAt: 0, deletedAt: null, days: null, now: 10 ** 15 })).toBe(false);
    expect(documentDue({ createdAt: 0, deletedAt: 5, days: null, now: 10 })).toBe(true);
    expect(documentDue({ createdAt: 0, deletedAt: null, days: 1, now: 24 * 60 * 60 * 1000 })).toBe(true);
  });

  it("drops secrets from audit metadata", () => {
    expect(sanitizeAuditMetadata({ fileType: "pdf", password: "nope", token: "abc", note: "ok" })).toEqual({
      fileType: "pdf",
      note: "ok",
    });
  });

  it("plans multipart parts at 8 MiB", () => {
    expect(planPartCount(1)).toBe(1);
    expect(planPartCount(PART_SIZE + 1)).toBe(2);
  });

  it("keeps an idle session closed", () => {
    const createdAt = 0;
    expect(staffSessionLive({ createdAt, lastSeenAt: 0, expiresAt: 10 ** 12 }, 8 * 60 * 60 * 1000)).toBe(false);
    expect(staffSessionLive({ createdAt, lastSeenAt: 1_000, expiresAt: 10 ** 12 }, 2_000)).toBe(true);
  });
});

describe("office preview", () => {
  it("reads text out of docx, pptx, and xlsx packages", () => {
    const docx = zipSync({ "word/document.xml": strToU8("<w:document><w:t>Quarterly note</w:t></w:document>") });
    const pptx = zipSync({ "ppt/slides/slide1.xml": strToU8("<a:t>Board slide</a:t>") });
    const xlsx = zipSync({
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Revenue</t></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8('<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>12</v></c></row></sheetData>'),
    });
    expect(previewOffice(docx, "docx")).toMatchObject({ kind: "docx", paragraphs: ["Quarterly note"] });
    expect(previewOffice(pptx, "pptx")?.text).toContain("Board slide");
    const sheet = previewOffice(xlsx, "xlsx");
    expect(sheet?.kind).toBe("xlsx");
    if (sheet?.kind === "xlsx") expect(sheet.rows).toEqual([["Revenue", "12"]]);
    expect(previewOffice(docx, "pdf")).toBeNull();
    expect(previewOffice(new Uint8Array([1, 2, 3]), "docx")).toBeNull();
    const huge = new Uint8Array(MAX_PREVIEW_ENTRY_BYTES + 1);
    expect(previewOffice(zipSync({ "word/document.xml": huge }), "docx")).toBeNull();
  });
});

describe("office stamp", () => {
  it("writes the email into docx, pptx, and xlsx bytes and refuses a bad package", () => {
    const docx = zipSync({
      "word/document.xml": strToU8(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly note</w:t></w:r></w:p></w:body></w:document>`,
      ),
    });
    const stampedDoc = stampOffice(docx, "docx", "viewer@example.com");
    const docXml = strFromU8(unzipSync(stampedDoc ?? new Uint8Array())["word/document.xml"] ?? new Uint8Array());
    expect(docXml).toContain("viewer@example.com");
    expect(docXml).toContain("Quarterly note");
    const pptx = zipSync({
      "ppt/slides/slide1.xml": strToU8(
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree></p:spTree></p:cSld></p:sld>`,
      ),
    });
    const slideXml = strFromU8(unzipSync(stampOffice(pptx, "pptx", "viewer@example.com") ?? new Uint8Array())["ppt/slides/slide1.xml"] ?? new Uint8Array());
    expect(slideXml).toContain("viewer@example.com");
    const xlsx = zipSync({
      "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`),
    });
    const sheetXml = strFromU8(unzipSync(stampOffice(xlsx, "xlsx", "viewer@example.com") ?? new Uint8Array())["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
    expect(sheetXml).toContain("viewer@example.com");
    expect(sheetXml).toContain("<v>1</v>");
    expect(stampOffice(new Uint8Array([1, 2, 3]), "docx", "viewer@example.com")).toBeNull();
  });
});

describe("staff domains and audit export", () => {
  it("leaves sign-in open until a domain list is set", () => {
    expect(staffSignInAllowed("ada@example.com", null)).toBe(true);
    expect(staffSignInAllowed("ada@example.com", ["example.com"])).toBe(true);
    expect(staffSignInAllowed("ada@sub.example.com", ["example.com"])).toBe(false);
    expect(normalizeStaffDomains([])).toBeNull();
    expect(normalizeStaffDomains(["Example.com"])).toEqual(["example.com"]);
    expect(normalizeStaffDomains(["not a domain"])).toBe("invalid");
  });

  it("exports audit rows as csv", () => {
    const csv = auditExportCsv([
      {
        id: "aud_1",
        createdAt: Date.parse("2026-11-26T12:00:00Z"),
        action: "user.sign_in",
        actorEmail: "=ada@example.com",
        targetType: "user",
        targetId: "usr_1",
        metadata: { role: "admin" },
      },
    ]);
    expect(csv).toContain("2026-11-26T12:00:00.000Z");
    expect(csv).toContain("'=ada@example.com");
  });
});
