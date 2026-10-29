import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import * as z from 'zod';

const url = z
	.url()
	.refine(v => !v.endsWith('/'), 'must not end with a slash')
	.refine(v => /^https?:$/.test(new URL(v).protocol), 'must be http(s)');

const schema = z
	.object({
		ENVIRONMENT: z.enum(['development', 'test', 'production']).default('development'),
		PORT: z.coerce.number().int().min(1).max(65535).default(4001),
		// Public base URL of this server: OAuth issuer and MCP resource identifier.
		MCP_PUBLIC_URL: url.default('http://localhost:4001'),
		// Base URL of the useshortly API (without /api/v1).
		API_URL: url.default('http://localhost:8080'),
		// Ed25519 private key (PKCS8 PEM, or base64 of that PEM) that signs the API tokens.
		MCP_SIGNING_KEY: z.string().min(1),
		// Better Auth secret: encrypts and signs its own data.
		AUTH_SECRET: z.string().min(32),
		// Better Auth database: its own SQLite file, optionally synced with Turso Cloud.
		MCP_DATABASE_PATH: z.string().min(1).default('data/mcp.db'),
		MCP_TURSO_DATABASE_URL: z.string().default(''),
		MCP_TURSO_AUTH_TOKEN: z.string().default(''),
		// Seconds between pull/push rounds with Turso Cloud.
		MCP_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(30),
		// Same Google OAuth client the API uses; empty hides "Continue with Google" on the sign-in page.
		GOOGLE_CLIENT_ID: z.string().default(''),
		// Read the visitor's address from X-Forwarded-For (set it behind a reverse proxy).
		TRUST_PROXY: z.enum(['true', 'false']).default('false'),
		// Comma separated origins allowed to call the OAuth endpoints from a browser.
		TRUSTED_ORIGINS: z.string().default(''),
	})
	.refine(e => !e.MCP_TURSO_DATABASE_URL || e.MCP_TURSO_AUTH_TOKEN, {
		message: 'MCP_TURSO_AUTH_TOKEN is required when MCP_TURSO_DATABASE_URL is set',
		path: ['MCP_TURSO_AUTH_TOKEN'],
	})
	.refine(e => e.ENVIRONMENT !== 'production' || e.MCP_PUBLIC_URL.startsWith('https://'), {
		message: 'MCP_PUBLIC_URL must be https in production',
		path: ['MCP_PUBLIC_URL'],
	});

export type Config = {
	environment: 'development' | 'test' | 'production';
	port: number;
	publicUrl: string;
	apiUrl: string;
	signingKey: KeyObject;
	authSecret: string;
	database: { path: string; tursoUrl: string; tursoAuthToken: string; syncIntervalMs: number };
	trustedOrigins: string[];
	googleClientId: string;
	trustProxy: boolean;
};

/** Reads an Ed25519 private key from a PKCS8 PEM, or from the base64 of that PEM. */
export function parseSigningKey(raw: string): KeyObject {
	let pem = raw.trim().replace(/\\n/g, '\n');
	if (!pem.includes('BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
	let key: KeyObject;
	try {
		key = createPrivateKey(pem);
	} catch {
		throw new Error('MCP_SIGNING_KEY is not a valid PKCS8 PEM private key');
	}
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new Error('MCP_SIGNING_KEY must be an Ed25519 key');
	}
	return key;
}

/** Base64 of the raw 32-byte public key: the value for the API's MCP_PUBLIC_KEY. */
export function publicKeyBase64(key: KeyObject): string {
	const jwk = createPublicKey(key).export({ format: 'jwk' });
	return Buffer.from(jwk.x ?? '', 'base64url').toString('base64');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const parsed = schema.safeParse(env);
	if (!parsed.success) {
		const problems = parsed.error.issues.map(i => `  - ${i.path.join('.') || 'env'}: ${i.message}`).join('\n');
		throw new Error(`Invalid configuration:\n${problems}`);
	}
	const e = parsed.data;
	return {
		environment: e.ENVIRONMENT,
		port: e.PORT,
		publicUrl: e.MCP_PUBLIC_URL,
		apiUrl: e.API_URL,
		signingKey: parseSigningKey(e.MCP_SIGNING_KEY),
		authSecret: e.AUTH_SECRET,
		database: {
			path: e.MCP_DATABASE_PATH,
			tursoUrl: e.MCP_TURSO_DATABASE_URL,
			tursoAuthToken: e.MCP_TURSO_AUTH_TOKEN,
			syncIntervalMs: e.MCP_SYNC_INTERVAL_SECONDS * 1000,
		},
		googleClientId: e.GOOGLE_CLIENT_ID,
		trustProxy: e.TRUST_PROXY === 'true',
		trustedOrigins: e.TRUSTED_ORIGINS.split(',')
			.map(o => o.trim())
			.filter(Boolean),
	};
}
