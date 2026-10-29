package link

import "strings"

const (
	minAliasLen      = 3
	maxAliasLen      = 15 // the redirect route only matches codes of up to 15 characters
	generatedCodeLen = 7  // generated codes have this length, so aliases never use it to avoid collisions
)

// reservedAliases are the paths served at the root, next to GET /{code}: the API and, when the web app shares the
// host, its pages (keep them in sync with apps/web/src/app/routes.ts and the proxy in apps/web/vite.config.ts).
var reservedAliases = map[string]struct{}{
	"api":       {},
	"v1":        {},
	"health":    {},
	"admin":     {},
	"auth":      {},
	"links":     {},
	"qr-code":   {},
	"campaigns": {},
	"domains":   {},
	"users":     {},
	"api-keys":  {},
	"docs":      {},
	"mcp":       {},
}

func validateAlias(alias string) error {
	if len(alias) < minAliasLen || len(alias) > maxAliasLen || len(alias) == generatedCodeLen {
		return ErrInvalidAlias
	}
	for _, r := range alias {
		isAlnum := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
		if !isAlnum && r != '_' && r != '-' {
			return ErrInvalidAlias
		}
	}
	if _, reserved := reservedAliases[strings.ToLower(alias)]; reserved {
		return ErrInvalidAlias
	}
	return nil
}
