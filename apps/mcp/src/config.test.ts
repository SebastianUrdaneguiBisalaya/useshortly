import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseSigningKey, publicKeyBase64 } from './config.js';

const pem = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const valid = {
	MCP_SIGNING_KEY: Buffer.from(pem).toString('base64'),
	AUTH_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
	it('applies defaults', () => {
		const c = loadConfig(valid);
		expect(c.port).toBe(4001);
		expect(c.publicUrl).toBe('http://localhost:4001');
		expect(c.apiUrl).toBe('http://localhost:8080');
		expect(c.database.path).toBe('data/mcp.db');
		expect(c.trustedOrigins).toEqual([]);
	});

	it('splits trusted origins', () => {
		const c = loadConfig({ ...valid, TRUSTED_ORIGINS: ' https://a.test , ,https://b.test' });
		expect(c.trustedOrigins).toEqual(['https://a.test', 'https://b.test']);
	});

	it.each([
		['missing signing key', { AUTH_SECRET: valid.AUTH_SECRET }, 'MCP_SIGNING_KEY'],
		['short auth secret', { ...valid, AUTH_SECRET: 'short' }, 'AUTH_SECRET'],
		['url with trailing slash', { ...valid, API_URL: 'http://localhost:8080/' }, 'API_URL'],
		['bad port', { ...valid, PORT: '99999' }, 'PORT'],
		['turso url without token', { ...valid, MCP_TURSO_DATABASE_URL: 'libsql://x' }, 'MCP_TURSO_AUTH_TOKEN'],
		['http in production', { ...valid, ENVIRONMENT: 'production' }, 'MCP_PUBLIC_URL'],
	])('rejects %s', (_name, env, field) => {
		expect(() => loadConfig(env)).toThrow(field);
	});
});

describe('parseSigningKey', () => {
	it('accepts PEM, escaped-newline PEM and base64 PEM', () => {
		for (const raw of [pem, pem.replace(/\n/g, '\\n'), valid.MCP_SIGNING_KEY]) {
			expect(parseSigningKey(raw).asymmetricKeyType).toBe('ed25519');
		}
	});

	it('rejects garbage and non-Ed25519 keys', () => {
		expect(() => parseSigningKey('nope')).toThrow('PKCS8');
		const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
		expect(() => parseSigningKey(rsa)).toThrow('Ed25519');
	});

	it('derives the raw public key the API expects', () => {
		const raw = Buffer.from(publicKeyBase64(parseSigningKey(pem)), 'base64');
		expect(raw).toHaveLength(32);
	});
});
