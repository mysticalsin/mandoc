import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export async function verifyAccessJwt(input: {
  jwt: string;
  teamDomain: string;
  audience: string;
  getKey?: JWTVerifyGetKey;
}): Promise<{ email: string } | null> {
  try {
    const getKey = input.getKey ?? createRemoteJWKSet(new URL(`https://${input.teamDomain}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(input.jwt, getKey, {
      audience: input.audience,
      issuer: `https://${input.teamDomain}`,
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email.includes("@")) return null;
    return { email };
  } catch {
    return null;
  }
}
