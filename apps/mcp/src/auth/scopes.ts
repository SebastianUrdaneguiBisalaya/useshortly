/** Scopes the MCP server grants. Write implies read, as for API keys. */
export const scopes = {
  read: "mcp:read",
  write: "mcp:write",
} as const;

export const supportedScopes = ["openid", "profile", "email", "offline_access", scopes.read, scopes.write];

/** The API scope a token's OAuth scopes translate to, or null if it has none of ours. */
export function apiScope(granted: readonly string[]): "read" | "write" | null {
  if (granted.includes(scopes.write)) return "write";
  if (granted.includes(scopes.read)) return "read";
  return null;
}
