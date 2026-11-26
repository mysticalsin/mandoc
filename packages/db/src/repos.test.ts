import { readFileSync } from "node:fs";
import { shareTokenHash } from "@mandoc/core";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDb, type Db } from "./client.js";
import { openTestDatabase } from "./node-d1.js";
import { findUserByEmail, insertShare, insertUser, shareColumns } from "./repos.js";

function database(): Db {
  const sql = readFileSync(fileURLToPath(new URL("../migrations/0001_init.sql", import.meta.url)), "utf8");
  return createDb(openTestDatabase(sql) as D1Database);
}

describe("schema", () => {
  it("keeps share tokens as a hash and a sealed copy", async () => {
    const columns = await shareColumns(database());
    expect(columns).toContain("token_hash");
    expect(columns).toContain("sealed_token");
    expect(columns).not.toContain("token");
  });

  it("round-trips a user and a hashed share", async () => {
    const db = database();
    const user = await insertUser(db, { email: "ada@example.com", role: "admin", now: 1 });
    expect(await findUserByEmail(db, "ada@example.com")).toMatchObject({ id: user.id, role: "admin" });
    const token = "share-token-value";
    await insertShare(db, {
      documentId: "doc_1",
      versionId: "ver_1",
      createdBy: user.id,
      tokenHash: await shareTokenHash(token),
      sealedToken: "sealed",
      expiresAt: 10,
      passwordHash: null,
      downloadAllowed: false,
      watermarkEnabled: false,
      recipients: ["viewer@example.com"],
      now: 1,
    });
    const columns = await shareColumns(db);
    expect(columns).not.toContain("token");
  });
});
