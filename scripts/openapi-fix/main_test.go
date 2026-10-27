package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func specWithImage(t *testing.T) Spec {
	t.Helper()
	var spec Spec
	require.NoError(t, json.Unmarshal([]byte(`{"paths": {"/img": {"get": {"responses": {"200": {
		"content": {"image/png": {"schema": {"type": "string"}}, "image/svg+xml": {"schema": {"type": "string"}}}}}}}}}`), &spec))
	return spec
}

func TestBinaryResponseMarksEveryMediaType(t *testing.T) {
	spec := specWithImage(t)

	require.NoError(t, apply(spec, []Fix{binaryResponse("GET", "/img", "200")}))

	for _, media := range dig(spec, "paths", "/img", "get", "responses", "200", "content").(map[string]any) {
		assert.Equal(t, map[string]any{"type": "string", "format": "binary"}, media.(map[string]any)["schema"])
	}
}

func TestFixFailsWhenTheRouteIsGone(t *testing.T) {
	cases := map[string]Fix{
		"unknown path":     binaryResponse("GET", "/missing", "200"),
		"unknown method":   binaryResponse("POST", "/img", "200"),
		"unknown response": binaryResponse("GET", "/img", "404"),
	}
	for name, f := range cases {
		t.Run(name, func(t *testing.T) {
			err := apply(specWithImage(t), []Fix{f})
			require.Error(t, err)
			assert.True(t, strings.HasPrefix(err.Error(), f.Name))
		})
	}
}

func TestEncodeKeepsHTMLCharacters(t *testing.T) {
	out, err := encode(Spec{"description": `"Bearer <token>" & more`})

	require.NoError(t, err)
	assert.Contains(t, string(out), `<token>`)
	assert.NotContains(t, string(out), `\`+`u003c`)
}
