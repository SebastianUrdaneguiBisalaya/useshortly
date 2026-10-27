import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Opens a SQLite file with better-sqlite3. WAL keeps readers from blocking the writer and
 * busy_timeout turns a short lock into a wait instead of an error.
 */
export function openLocal(path: string): Database.Database {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path);
	db.pragma('journal_mode = WAL');
	db.pragma('busy_timeout = 5000');
	db.pragma('synchronous = NORMAL');
	db.pragma('foreign_keys = ON');
	return db;
}
