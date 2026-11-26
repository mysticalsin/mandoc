import { DatabaseSync, type SQLInputValue } from "node:sqlite";

function normalize(params: unknown[]): SQLInputValue[] {
  return params.map((value) => {
    if (value == null) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") return value;
    if (value instanceof Uint8Array) return value;
    throw new Error(`unsupported sql parameter ${typeof value}`);
  });
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, normalize(params));
  }

  private prepared() {
    return this.db.prepare(this.sql);
  }

  async all(): Promise<{ results: Record<string, unknown>[]; success: true; meta: Record<string, never> }> {
    const results = this.prepared().all(...this.params) as Record<string, unknown>[];
    return { results, success: true, meta: {} };
  }

  async raw(): Promise<unknown[][]> {
    const statement = this.prepared();
    const columns = statement.columns();
    const rows = statement.all(...this.params) as Record<string, unknown>[];
    return rows.map((row) => columns.map((column) => row[column.name]));
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const result = this.prepared().run(...this.params);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async first<T>(): Promise<T | null> {
    const { results } = await this.all();
    return (results[0] as T | undefined) ?? null;
  }
}

/** D1-shaped wrapper around node:sqlite so Drizzle's D1 driver runs in unit tests. */
export function nodeD1(db: DatabaseSync): unknown {
  return {
    prepare(sql: string) {
      return new Statement(db, sql);
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    async batch(statements: Statement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      return results;
    },
    dump() {
      return Promise.resolve(new ArrayBuffer(0));
    },
  };
}

export function openTestDatabase(sql: string): unknown {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  return nodeD1(db);
}
