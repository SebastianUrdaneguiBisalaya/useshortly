import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { migrate } from './auth/migrate.js';
import { authOptions } from './auth/options.js';
import { loadConfig } from './config.js';
import { openLocal } from './db/local.js';

const config = loadConfig({
	MCP_SIGNING_KEY: generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
	AUTH_SECRET: 'x'.repeat(32),
});

const db = openLocal(':memory:');
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
	const options = authOptions(config, db);
	await migrate(options);
	app = createApp({ config, auth: createAuth(options), identity: {} as never, api: {} as never });
});
afterAll(() => db.close());

const json = async (path: string, init?: RequestInit) => {
	const res = await app.request(`${config.publicUrl}${path}`, init);
	return { res, body: (await res.json().catch(() => null)) as Record<string, any> | null };
};

describe('discovery', () => {
	it('serves authorization server metadata for the issuer', async () => {
		const { res, body } = await json('/.well-known/oauth-authorization-server/api/auth');
		expect(res.status).toBe(200);
		expect(body?.issuer).toBe('http://localhost:4001/api/auth');
		expect(body?.authorization_endpoint).toBe('http://localhost:4001/api/auth/oauth2/authorize');
		expect(body?.token_endpoint).toBe('http://localhost:4001/api/auth/oauth2/token');
		expect(body?.code_challenge_methods_supported).toEqual(['S256']);
		expect(body?.scopes_supported).toEqual(expect.arrayContaining(['mcp:read', 'mcp:write']));
		expect(body?.client_id_metadata_document_supported).toBe(true);
	});

	it('does not offer dynamic client registration', async () => {
		const { body } = await json('/.well-known/oauth-authorization-server/api/auth');
		expect(body?.registration_endpoint).toBeUndefined();
		const { res } = await json('/api/auth/oauth2/register', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ redirect_uris: ['http://localhost:9/cb'], client_name: 'x' }),
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
	});

	it('serves protected resource metadata bound to the MCP endpoint', async () => {
		for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
			const { res, body } = await json(path);
			expect(res.status, path).toBe(200);
			expect(body?.resource).toBe('http://localhost:4001/mcp');
			expect(body?.authorization_servers).toContain('http://localhost:4001/api/auth');
			expect(body?.scopes_supported).toEqual(expect.arrayContaining(['mcp:read', 'mcp:write']));
			expect(body?.scopes_supported).not.toContain('openid');
		}
	});

	it('publishes an EdDSA signing key', async () => {
		const { res, body } = await json('/api/auth/jwks');
		expect(res.status).toBe(200);
		expect(body?.keys?.[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
		expect(body?.keys?.[0]).not.toHaveProperty('d');
	});
});

describe('hardening', () => {
	it('does not let a session mint a JWT through the jwt plugin', async () => {
		const { res } = await json('/api/auth/token');
		expect(res.status).toBe(404);
	});

	it('opens CORS only for discovery, keys and the token endpoint', async () => {
		const open = await app.request(`${config.publicUrl}/.well-known/oauth-protected-resource`, {
			headers: { origin: 'https://inspector.example' },
		});
		expect(open.headers.get('access-control-allow-origin')).toBe('*');
		expect(open.headers.get('access-control-allow-credentials')).toBeNull();

		const closed = await app.request(`${config.publicUrl}/api/auth/get-session`, {
			headers: { origin: 'https://evil.example' },
		});
		expect(closed.headers.get('access-control-allow-origin')).toBeNull();
	});
});

describe('health', () => {
	it('answers ok', async () => {
		const { res, body } = await json('/health');
		expect(res.status).toBe(200);
		expect(body).toEqual({ status: 'ok' });
	});
});
