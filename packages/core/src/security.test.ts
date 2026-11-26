import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  canChangeUser,
  canReadDocument,
  csrfAllows,
  documentDue,
  downloadDecision,
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
  previewOffice,
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
    expect(downloadDecision({ downloadAllowed: true, watermarkEnabled: true, fileType: "pptx", byteSize: 10 })).toBe("unstampable");
    expect(viewDecision({ watermarkEnabled: true, fileType: "pdf", byteSize: 10 })).toBe("stamp");
    expect(viewDecision({ watermarkEnabled: true, fileType: "docx", byteSize: 10 })).toBe("unstampable");
    expect(viewDecision({ watermarkEnabled: false, fileType: "pdf", byteSize: 10 })).toBe("allow");
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
      "xl/sharedStrings.xml": strToU8('<sst><si><t>Revenue</t></si></sst>'),
      "xl/worksheets/sheet1.xml": strToU8('<sheetData><c t="s"><v>0</v></c></sheetData>'),
    });
    expect(previewOffice(docx, "docx")?.text).toContain("Quarterly note");
    expect(previewOffice(pptx, "pptx")?.text).toContain("Board slide");
    expect(previewOffice(xlsx, "xlsx")?.text).toContain("Revenue");
    expect(previewOffice(docx, "pdf")).toBeNull();
  });
});
