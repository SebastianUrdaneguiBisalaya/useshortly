package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
)

// The binary embeds the zone database (time/tzdata), so every zone the web app offers resolves even where the host has none.
func TestTimeZonesTheWebAppOffersResolve(t *testing.T) {
	for _, name := range []string{
		"America/Lima", "America/Mexico_City", "America/Bogota", "America/Argentina/Buenos_Aires", "America/Sao_Paulo",
		"America/New_York", "Europe/Madrid", "Europe/London", "Asia/Tokyo", "Asia/Kolkata", "Australia/Sydney", "Pacific/Auckland",
	} {
		loc, err := analytics.LoadLocation(name)
		require.NoError(t, err, name)
		assert.Equal(t, name, loc.String())
	}
}
