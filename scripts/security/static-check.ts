import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url);
const skip = new Set(["node_modules", "dist", ".wrangler", ".git", "coverage"]);
const forbidden: { pattern: RegExp; reason: string }[] = [
  { pattern: /r2\.cloudflarestorage\.com|https?:\/\/[^)\s]*\.r2\.dev/i, reason: "raw R2 URL" },
  { pattern: /BEGIN (RSA |OPENSSH )?PRIVATE KEY/, reason: "private key" },
  { pattern: /\beval\s*\(/, reason: "eval" },
  { pattern: /new Function\s*\(/, reason: "Function constructor" },
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...files(path));
    else if (/\.(ts|tsx|js|mjs|jsonc|sql)$/.test(name) && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

const failures: string[] = [];
for (const path of files(root.pathname)) {
  if (path.endsWith(`${join("scripts", "security", "static-check.ts")}`)) continue;
  const text = readFileSync(path, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) failures.push(`${path}: ${rule.reason}`);
  }
}

const schema = readFileSync(new URL("../../packages/db/src/schema.ts", import.meta.url), "utf8");
const shares = schema.slice(schema.indexOf('sqliteTable(\n  "shares"'), schema.indexOf('sqliteTable("share_recipients"'));
if (!shares.includes("tokenHash")) failures.push("shares schema is missing tokenHash");
if (/^\s*token:\s*text\(/m.test(shares)) failures.push("shares schema stores a raw token column");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("static check ok");
