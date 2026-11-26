import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const path = new URL("../apps/api/.dev.vars", import.meta.url);
if (existsSync(path)) process.exit(0);

const secret = () => randomBytes(32).toString("base64url");
writeFileSync(
  path,
  [
    `SESSION_PEPPER=${secret()}`,
    `OTP_PEPPER=${secret()}`,
    `GRANT_SECRET=${secret()}`,
    `SHARE_LINK_KEY=${secret()}`,
    "BOOTSTRAP_ADMIN_EMAIL=ada@example.com",
    "",
  ].join("\n"),
);
