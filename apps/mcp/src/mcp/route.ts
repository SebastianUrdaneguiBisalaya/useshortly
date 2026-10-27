import { requireMcpAuth } from '@better-auth/mcp';
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { createInsufficientScopeError } from 'better-auth/oauth2';
import type { ApiClient } from '../api/client.js';
import { principalFromClaims } from '../api/principal.js';
import type { Principal } from '../api/token.js';
import type { Auth } from '../auth/auth.js';
import { basePath, resourcePath } from '../auth/options.js';
import { scopes } from '../auth/scopes.js';
import type { Config } from '../config.js';
import { createMcpServer } from './server.js';

const principalKey = 'principal';

/**
 * POST /mcp: the MCP endpoint. Better Auth checks the access token (signature, issuer, audience,
 * expiry); a token without the API user or an MCP scope gets a step-up challenge. The handler
 * then serves only the 2026-07-28 protocol, statelessly: a fresh server per request, bound to
 * the user behind the token. The token itself stops here: calls to the API are signed anew.
 */
export function mcpRoute({ config, auth, api }: { config: Config; auth: Auth; api: ApiClient }) {
	const handler = createMcpHandler(
		({ authInfo }) => {
			const principal = authInfo?.extra?.[principalKey] as Principal | undefined;
			if (!principal) throw new Error('the MCP handler was reached without a verified principal');
			return createMcpServer(api.as(principal));
		},
		{ legacy: 'reject', onerror: error => console.error('mcp handler', error) }
	);

	return requireMcpAuth(
		auth,
		async (request, claims) => {
			const principal = principalFromClaims(claims);
			if (!principal) throw createInsufficientScopeError([scopes.read]);
			const authInfo: AuthInfo = {
				// The token is not needed past this point and must not travel further.
				token: '',
				clientId: typeof claims.azp === 'string' ? claims.azp : '',
				scopes: typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
				expiresAt: typeof claims.exp === 'number' ? claims.exp : undefined,
				extra: { [principalKey]: principal },
			};
			return handler.fetch(request, { authInfo });
		},
		{
			resource: `${config.publicUrl}${resourcePath}`,
			issuer: `${config.publicUrl}${basePath}`,
			// The keys are fetched from this very server. Going through loopback instead of the public URL
			// keeps verification independent of DNS, TLS and of whether the host can reach itself by name.
			jwksUrl: `http://127.0.0.1:${config.port}${basePath}/jwks`,
			challengeScopes: [scopes.read],
		}
	);
}
