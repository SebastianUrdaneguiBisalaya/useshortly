import { type KeyObject, randomUUID, sign } from 'node:crypto';

/** The scope an API token carries: what the user granted to the MCP client. */
export type ApiScope = 'read' | 'write';

/** Who a call acts for, as vouched by a verified MCP access token. */
export type Principal = { userId: number; scope: ApiScope };

// The API accepts exactly this issuer and audience, and no token that lives longer than 5 minutes.
export const issuer = 'useshortly-mcp';
export const audience = 'useshortly-api';
export const tokenTtlSeconds = 60;

export type TokenSigner = (principal: Principal) => string;

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Signs the short-lived token the API trusts (EdDSA, see the API's mcptoken package). One token
 * per call: it dies in a minute, so a leaked one is of little use, and it is never reused.
 * The API only holds the public key, so it can verify these tokens but never mint them.
 */
export function createTokenSigner(key: KeyObject, now: () => number = Date.now): TokenSigner {
	if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
		throw new Error('the API token signer needs an Ed25519 private key');
	}
	const header = b64({ alg: 'EdDSA', typ: 'JWT' });
	return ({ userId, scope }) => {
		if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('invalid API user id');
		const iat = Math.floor(now() / 1000);
		const payload = b64({
			iss: issuer,
			aud: audience,
			sub: String(userId),
			scope,
			iat,
			exp: iat + tokenTtlSeconds,
			jti: randomUUID(),
		});
		const signed = `${header}.${payload}`;
		return `${signed}.${sign(null, Buffer.from(signed), key).toString('base64url')}`;
	};
}
