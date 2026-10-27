import * as z from 'zod';
import { ApiAuthError, ApiError, ApiForbiddenError, ApiNotFoundError, ApiRateLimitedError, ApiRequestError, ApiUnavailableError } from './errors.js';
import type { Principal, TokenSigner } from './token.js';

type Query = Record<string, string | number | boolean | undefined>;
type Options = { query?: Query; body?: unknown };

const errorBody = z.object({
	error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

const maxResponseBytes = 2 * 1024 * 1024;

/** A numeric id for a URL path: refuses anything that could change the path. */
export function segment(id: number): string {
	if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`invalid id: ${id}`);
	return String(id);
}

export type ApiClientOptions = {
	apiUrl: string;
	sign: TokenSigner;
	fetch?: typeof fetch;
	timeoutMs?: number;
};

/**
 * Calls the useshortly API on behalf of one user. Every call is signed with a fresh short-lived
 * token built from a Principal; the access token the MCP client sent is never forwarded (the
 * MCP spec forbids passing it through), and there is no way to hand one to this class.
 */
export class ApiClient {
	readonly #base: string;
	readonly #sign: TokenSigner;
	readonly #fetch: typeof fetch;
	readonly #timeoutMs: number;

	constructor({ apiUrl, sign, fetch: doFetch = fetch, timeoutMs = 10_000 }: ApiClientOptions) {
		this.#base = `${apiUrl}/api/v1`;
		this.#sign = sign;
		this.#fetch = doFetch;
		this.#timeoutMs = timeoutMs;
	}

	/** The API as seen by one user, with the scope the MCP client was granted. */
	as(principal: Principal): UserApi {
		return new UserApi(this, principal);
	}

	/** @internal Used by UserApi. */
	async send(principal: Principal, method: string, path: string, { query, body }: Options): Promise<Response> {
		const url = new URL(`${this.#base}${path}`);
		for (const [key, value] of Object.entries(query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}
		const headers: Record<string, string> = { authorization: `Bearer ${this.#sign(principal)}`, accept: 'application/json' };
		if (body !== undefined) headers['content-type'] = 'application/json';

		let res: Response;
		try {
			res = await this.#fetch(url, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.#timeoutMs),
				// A redirect would carry the Authorization header to wherever it points.
				redirect: 'error',
			});
		} catch (error) {
			throw new ApiUnavailableError('the useshortly API could not be reached', error);
		}
		if (!res.ok) throw await toError(res);
		return res;
	}
}

export class UserApi {
	constructor(
		private readonly client: ApiClient,
		readonly principal: Principal
	) {}

	/** GET returning the API's `{data, meta?}` envelope, with `data` checked against the schema. */
	async get<T extends z.ZodType>(path: string, data: T, options: Options = {}) {
		return this.#envelope('GET', path, data, options);
	}
	async post<T extends z.ZodType>(path: string, data: T, options: Options = {}) {
		return this.#envelope('POST', path, data, options);
	}
	/** DELETE, which answers 204 with no body. */
	async delete(path: string, options: Options = {}): Promise<void> {
		await this.client.send(this.principal, 'DELETE', path, options);
	}
	/** GET of a binary body, such as a QR image. */
	async getBytes(path: string, options: Options = {}): Promise<{ bytes: Uint8Array; contentType: string }> {
		const res = await this.client.send(this.principal, 'GET', path, options);
		return { bytes: await readLimited(res), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
	}

	async #envelope<T extends z.ZodType>(method: string, path: string, data: T, options: Options) {
		const res = await this.client.send(this.principal, method, path, options);
		let json: unknown;
		try {
			json = JSON.parse(new TextDecoder().decode(await readLimited(res)));
		} catch (error) {
			throw new ApiUnavailableError('the useshortly API sent an unreadable reply', error);
		}
		const parsed = z.object({ data: data, meta: z.unknown().optional() }).safeParse(json);
		if (!parsed.success) throw new ApiUnavailableError('the useshortly API sent an unexpected reply');
		const ok = parsed.data as { data: z.output<T>; meta?: unknown };
		return { data: ok.data, meta: ok.meta };
	}
}

/** Reads a body but gives up past the cap, so a misbehaving server cannot exhaust memory. */
async function readLimited(res: Response): Promise<Uint8Array> {
	const declared = Number(res.headers.get('content-length'));
	if (declared > maxResponseBytes) throw new ApiUnavailableError('the useshortly API reply is too large');
	const reader = res.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxResponseBytes) {
			await reader.cancel();
			throw new ApiUnavailableError('the useshortly API reply is too large');
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

async function toError(res: Response): Promise<ApiError> {
	const parsed = errorBody.safeParse(await res.json().catch(() => null));
	const { code, message, details } = parsed.success ? parsed.data.error : { code: 'error', message: `the API answered ${res.status}`, details: undefined };
	switch (res.status) {
		case 401:
			return new ApiAuthError(401, code, message);
		case 403:
			return new ApiForbiddenError(403, code, message);
		case 404:
			return new ApiNotFoundError(404, code, message);
		case 429: {
			const wait = Number(res.headers.get('retry-after'));
			return new ApiRateLimitedError(code, message, Number.isFinite(wait) && wait > 0 ? wait : null);
		}
		case 400:
		case 409:
		case 413:
		case 415:
		case 422:
			return new ApiRequestError(res.status, code, message, details);
		default:
			return new ApiUnavailableError(res.status >= 500 ? 'the useshortly API failed' : message);
	}
}
