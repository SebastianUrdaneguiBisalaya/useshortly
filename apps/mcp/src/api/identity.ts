import * as z from 'zod';

/** Who the API says the user is. The MCP server keeps no password and no API session. */
export type Identity = {
	apiUserId: number;
	email: string;
	emailVerified: boolean;
	name: string;
	imageUrl: string | null;
};

export class InvalidCredentialsError extends Error {
	constructor() {
		super('invalid credentials');
	}
}
export class RateLimitedError extends Error {
	constructor() {
		super('rate limited by the API');
	}
}
export class IdentityUnavailableError extends Error {
	constructor(cause?: unknown) {
		super('the API is unavailable', { cause });
	}
}

/** How the sign-in page proves who the user is. The API is the only source of identity. */
export interface IdentityProvider {
	password(email: string, password: string, clientIp?: string): Promise<Identity>;
	google(code: string, clientIp?: string): Promise<Identity>;
}

const session = z.object({
	data: z.object({
		user: z.object({
			id: z.number().int().positive(),
			email: z.string().min(1),
			email_verified: z.boolean(),
			first_name: z.string(),
			last_name: z.string(),
			image_url: z.string().optional(),
		}),
		refresh_token: z.string().min(1),
	}),
});

type Options = { apiUrl: string; fetch?: typeof fetch; timeoutMs?: number };

export function createIdentityClient({ apiUrl, fetch: doFetch = fetch, timeoutMs = 10_000 }: Options): IdentityProvider {
	const post = async (path: string, body: unknown, clientIp?: string): Promise<Response> => {
		try {
			return await doFetch(`${apiUrl}/api/v1${path}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					// Lets an API behind a trusted proxy rate-limit the real visitor, not this server.
					...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs),
				redirect: 'error',
			});
		} catch (error) {
			throw new IdentityUnavailableError(error);
		}
	};

	// The API starts a session on every login. Only the identity is needed, so end it at once.
	const revoke = async (refreshToken: string) => {
		try {
			await post('/auth/logout', { refresh_token: refreshToken });
		} catch (error) {
			console.warn('could not revoke the API session created for sign-in', error);
		}
	};

	const login = async (path: string, body: unknown, clientIp?: string): Promise<Identity> => {
		const res = await post(path, body, clientIp);
		if (res.status === 429) throw new RateLimitedError();
		if (res.status === 400 || res.status === 401 || res.status === 403) throw new InvalidCredentialsError();
		if (!res.ok) throw new IdentityUnavailableError(`status ${res.status}`);
		const parsed = session.safeParse(await res.json().catch(() => null));
		if (!parsed.success) throw new IdentityUnavailableError('unexpected response shape');
		const { user, refresh_token } = parsed.data.data;
		await revoke(refresh_token);
		return {
			apiUserId: user.id,
			email: user.email.toLowerCase(),
			emailVerified: user.email_verified,
			name: `${user.first_name} ${user.last_name}`.trim() || user.email,
			imageUrl: user.image_url || null,
		};
	};

	return {
		password: (email, password, clientIp) => login('/auth/login', { email, password }, clientIp),
		google: (code, clientIp) => login('/auth/google', { code }, clientIp),
	};
}
