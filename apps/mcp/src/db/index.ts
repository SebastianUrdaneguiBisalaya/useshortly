import type { BetterAuthOptions } from "better-auth";
import type { Config } from "../config.js";
import { openLocal } from "./local.js";
import { SyncLoop } from "./sync-loop.js";
import { TursoDialect } from "./turso-dialect.js";

/** The Better Auth database and how to shut it down. */
export type AuthDatabase = {
  /** Value for Better Auth's `database` option. */
  database: NonNullable<BetterAuthOptions["database"]>;
  close(): Promise<void>;
};

/**
 * Opens the Better Auth database, a SQLite file of its own (never the API's). Local only
 * unless a Turso URL is set, in which case it also syncs with Turso Cloud.
 */
export async function openDatabase(db: Config["database"]): Promise<AuthDatabase> {
  if (!db.tursoUrl) {
    const local = openLocal(db.path);
    return { database: local, close: async () => void local.close() };
  }
  const { connect } = await import("@tursodatabase/sync");
  const synced = await connect({ path: db.path, url: db.tursoUrl, authToken: db.tursoAuthToken });
  await synced.exec("PRAGMA foreign_keys = ON");
  const loop = new SyncLoop(synced, db.syncIntervalMs);
  await loop.round();
  loop.start();
  return {
    database: { dialect: new TursoDialect(synced), type: "sqlite" },
    close: async () => {
      await loop.stop();
      await synced.close();
    },
  };
}
