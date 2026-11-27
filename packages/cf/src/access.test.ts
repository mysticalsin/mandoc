import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyAccessJwt } from "./access.js";

describe("cloudflare access", () => {
  it("accepts a signed staff token and rejects the wrong audience", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const getKey = createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256", kid: "test" }] });
    const token = await new SignJWT({ email: "Ada@Example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer("https://mantu.cloudflareaccess.com")
      .setAudience("staff-aud")
      .setExpirationTime("5m")
      .sign(privateKey);
    expect(await verifyAccessJwt({ jwt: token, teamDomain: "mantu.cloudflareaccess.com", audience: "staff-aud", getKey })).toEqual({
      email: "ada@example.com",
    });
    expect(await verifyAccessJwt({ jwt: token, teamDomain: "mantu.cloudflareaccess.com", audience: "viewer-aud", getKey })).toBeNull();
    expect(await verifyAccessJwt({ jwt: `${token}x`, teamDomain: "mantu.cloudflareaccess.com", audience: "staff-aud", getKey })).toBeNull();
  });
});
