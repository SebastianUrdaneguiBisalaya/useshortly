import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "@tursodatabase/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { openLocal } from "../db/local.js";
import { TursoDialect } from "../db/turso-dialect.js";
import { migrate } from "./migrate.js";
import { authOptions, tableNames } from "./options.js";

const config = loadConfig({
  MCP_SIGNING_KEY: generateKeyPairSync("ed25519")
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString(),
  AUTH_SECRET: "x".repeat(32),
});

type Backend = {
  database: Parameters<typeof authOptions>[1];
  rows(sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, ...params: unknown[]): Promise<void>;
  close(): Promise<void>;
};

// The same migrations must work on both engines the server can run on.
const backends: Record<string, (dir: string) => Promise<Backend>> = {
  "better-sqlite3": async (dir) => {
    const db = openLocal(join(dir, "nested", "mcp.db"));
    return {
      database: db,
      rows: async (sql, ...p) => db.prepare(sql).all(...p) as Record<string, unknown>[],
      run: async (sql, ...p) => void db.prepare(sql).run(...p),
      close: async () => void db.close(),
    };
  },
  "turso dialect": async (dir) => {
    const db = await connect(join(dir, "mcp.db"));
    return {
      database: { dialect: new TursoDialect(db), type: "sqlite" },
      rows: async (sql, ...p) => (await (await db.prepare(sql)).all(...p)) as Record<string, unknown>[],
      run: async (sql, ...p) => void (await (await db.prepare(sql)).run(...p)),
      close: () => db.close(),
    };
  },
};

describe.each(Object.entries(backends))("migrate on %s", (_name, open) => {
  let dir: string;
  let b: Backend;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "mcp-db-"));
    b = await open(dir);
  });

  afterEach(async () => {
    await b.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const tables = async () =>
    (await b.rows("select name from sqlite_master where type = 'table'"))
      .map((r) => String(r.name))
      .filter((n) => !n.startsWith("sqlite_"));

  it("creates only mcp_ tables, with a user_id column on mcp_user", async () => {
    const result = await migrate(authOptions(config, b.database));
    expect(result.created.sort()).toEqual(Object.values(tableNames).sort());
    expect((await tables()).every((t) => t.startsWith("mcp_"))).toBe(true);

    const cols = (await b.rows("pragma table_info(mcp_user)")).map((c) => c.name);
    expect(cols).toContain("user_id");
  });

  it("is a no-op when already up to date", async () => {
    await migrate(authOptions(config, b.database));
    const again = await migrate(authOptions(config, b.database));
    expect(again).toEqual({ created: [], added: [] });
  });

  it("keeps user_id unique so one API user maps to one mcp_user", async () => {
    await migrate(authOptions(config, b.database));
    const insert = (id: string, email: string) =>
      b.run(
        "insert into mcp_user (id, name, email, emailVerified, createdAt, updatedAt, user_id) values (?, 'n', ?, 1, 0, 0, 7)",
        id,
        email,
      );
    await insert("a", "a@x.test");
    await expect(insert("b", "b@x.test")).rejects.toThrow(/UNIQUE/i);
  });
});

describe("openLocal", () => {
  it("creates the folder and enables WAL, foreign keys and busy timeout", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-db-"));
    const db = openLocal(join(dir, "nested", "mcp.db"));
    try {
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
