import type { BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';

export type MigrationResult = { created: string[]; added: string[] };

/**
 * Applies the pending Better Auth migrations: creates missing tables and adds missing columns.
 * Safe to run on every boot (a no-op when up to date). It refuses unsafe changes, such as a
 * required column without default on a populated table, instead of guessing.
 */
export async function migrate(options: BetterAuthOptions): Promise<MigrationResult> {
	const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(options);
	await runMigrations();
	return {
		created: toBeCreated.map(t => t.table),
		added: toBeAdded.map(t => t.table),
	};
}
