/** Scopes the MCP server grants. Write implies read, as for API keys. */
export const scopes = {
	read: 'mcp:read',
	write: 'mcp:write',
} as const;

export const supportedScopes = ['openid', 'profile', 'email', 'offline_access', scopes.read, scopes.write];

/** The API scope a token's OAuth scopes translate to, or null if it has none of ours. */
export function apiScope(granted: readonly string[]): 'read' | 'write' | null {
	if (granted.includes(scopes.write)) return 'write';
	if (granted.includes(scopes.read)) return 'read';
	return null;
}

/** What a scope lets the client do, in the words the consent screen uses. */
export const scopeDescriptions: Record<string, { title: string; detail: string }> = {
	[scopes.read]: {
		title: 'View your useshortly data',
		detail: 'Organizations, links, custom domains and click statistics.',
	},
	[scopes.write]: {
		title: 'Change your useshortly data',
		detail: 'Create and delete links and manage custom domains.',
	},
	openid: { title: 'Know who you are', detail: 'Your account identifier.' },
	profile: { title: 'See your name', detail: 'The name on your account.' },
	email: { title: 'See your email address', detail: 'The email on your account.' },
	offline_access: {
		title: 'Stay connected',
		detail: 'Keep access until you revoke it, without asking you to sign in again.',
	},
};

/** Scopes the user may switch off on the consent screen: the rest are not a choice. */
export const isChoosable = (scope: string): boolean => scope === scopes.read || scope === scopes.write;
