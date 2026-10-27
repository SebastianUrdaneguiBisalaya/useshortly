import { describe, expect, it } from 'vitest';
import { principalFromClaims } from './principal.js';

describe('principalFromClaims', () => {
	it('reads the API user and the strongest MCP scope', () => {
		expect(principalFromClaims({ api_user_id: 7, scope: 'openid mcp:read' })).toEqual({ userId: 7, scope: 'read' });
		expect(principalFromClaims({ api_user_id: 7, scope: 'mcp:read mcp:write offline_access' })).toEqual({ userId: 7, scope: 'write' });
	});

	it.each([
		['no API user', { scope: 'mcp:read' }],
		['API user as string', { api_user_id: '7', scope: 'mcp:read' }],
		['zero user', { api_user_id: 0, scope: 'mcp:read' }],
		['fractional user', { api_user_id: 1.5, scope: 'mcp:read' }],
		['no MCP scope', { api_user_id: 7, scope: 'openid profile' }],
		['no scope claim', { api_user_id: 7 }],
		['scope not a string', { api_user_id: 7, scope: ['mcp:read'] }],
	])('refuses %s', (_name, claims) => {
		expect(principalFromClaims(claims)).toBeNull();
	});
});
