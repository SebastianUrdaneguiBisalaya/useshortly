import {
	CompiledQuery,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	type DatabaseConnection,
	type Dialect,
	type Driver,
	type Kysely,
	type QueryResult,
	type TransactionSettings,
} from 'kysely';

/** The slice of a Turso database (local or synced) the dialect needs. */
export type TursoLike = {
	prepare(sql: string): Promise<{
		reader: boolean;
		all(...params: unknown[]): Promise<unknown[]>;
		run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
	}>;
};

/**
 * Kysely dialect over Turso's promise API, so Better Auth can use a database that has no
 * synchronous driver. SQLite has one writer, so there is a single connection and callers
 * queue on it: a transaction keeps it until it commits or rolls back.
 */
export class TursoDialect implements Dialect {
	constructor(private readonly db: TursoLike) {}

	createDriver(): Driver {
		return new TursoDriver(this.db);
	}
	createQueryCompiler() {
		return new SqliteQueryCompiler();
	}
	createAdapter() {
		return new SqliteAdapter();
	}
	createIntrospector(db: Kysely<any>) {
		return new SqliteIntrospector(db);
	}
}

class TursoDriver implements Driver {
	readonly #connection: TursoConnection;
	#tail: Promise<void> = Promise.resolve();
	#release: (() => void) | undefined;

	constructor(db: TursoLike) {
		this.#connection = new TursoConnection(db);
	}

	async init() {}

	async acquireConnection(): Promise<DatabaseConnection> {
		const previous = this.#tail;
		let release!: () => void;
		this.#tail = new Promise<void>(resolve => (release = resolve));
		await previous;
		this.#release = release;
		return this.#connection;
	}

	async releaseConnection() {
		const release = this.#release;
		this.#release = undefined;
		release?.();
	}

	async beginTransaction(connection: DatabaseConnection, _settings: TransactionSettings) {
		await connection.executeQuery(CompiledQuery.raw('begin'));
	}
	async commitTransaction(connection: DatabaseConnection) {
		await connection.executeQuery(CompiledQuery.raw('commit'));
	}
	async rollbackTransaction(connection: DatabaseConnection) {
		await connection.executeQuery(CompiledQuery.raw('rollback'));
	}

	async destroy() {}
}

class TursoConnection implements DatabaseConnection {
	constructor(private readonly db: TursoLike) {}

	async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
		const stmt = await this.db.prepare(query.sql);
		const params = [...query.parameters];
		if (stmt.reader) {
			return { rows: (await stmt.all(...params)) as R[] };
		}
		const result = await stmt.run(...params);
		return {
			rows: [],
			numAffectedRows: BigInt(result.changes),
			insertId: BigInt(result.lastInsertRowid),
		};
	}

	// eslint-disable-next-line require-yield
	async *streamQuery(): AsyncIterableIterator<never> {
		throw new Error('Streaming queries are not supported by the Turso dialect');
	}
}
