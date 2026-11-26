import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

const base = {
  APP_ORIGIN: "https://mandoc.example",
  SESSION_PEPPER: "session",
  OTP_PEPPER: "otp",
  GRANT_SECRET: "grant",
  SHARE_LINK_KEY: "share",
  BOOTSTRAP_ADMIN_EMAIL: "Ada@Example.com",
  ACCESS_TEAM_DOMAIN: "mantu.cloudflareaccess.com",
  ACCESS_AUD_STAFF: "staff",
  ACCESS_AUD_VIEWER: "viewer",
};

describe("parseConfig", () => {
  it("fails closed in production", () => {
    expect(() => parseConfig({ ...base, ENVIRONMENT: "production", AUTH_PROVIDER: "otp" })).toThrow(/OTP/);
    expect(() => parseConfig({ ...base, ENVIRONMENT: "production", MAILER: "dev-outbox" })).toThrow(/mailer/);
    expect(() => parseConfig({ ...base, ENVIRONMENT: "production", ACCESS_AUD_STAFF: undefined })).toThrow(/access/);
    const config = parseConfig({ ...base, ENVIRONMENT: "production", MAILER: "disabled", AUTH_PROVIDER: "cloudflare-access" });
    expect(config.bootstrapAdminEmail).toBe("ada@example.com");
    expect(config.mailer).toBe("disabled");
  });
});
