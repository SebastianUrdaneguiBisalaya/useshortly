import { apiScope } from '../auth/scopes.js';
import type { Principal } from './token.js';

/**
 * The user and scope behind a verified MCP access token, or null when the token lacks either:
 * the API user id claim (added at sign-in) or one of the MCP scopes. Null means refuse the call.
 */
export function principalFromClaims(claims: Record<string, unknown>): Principal | null {
	const userId = claims.api_user_id;
	if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) return null;
	const granted = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
	const scope = apiScope(granted);
	return scope ? { userId, scope } : null;
}
