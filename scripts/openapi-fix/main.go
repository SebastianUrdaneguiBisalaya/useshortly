// Command openapi-fix patches what swag cannot express in the spec it generates: the QR endpoint
// answers an image, which OpenAPI 3.1 writes as {"type": "string", "format": "binary"}, but swag
// only emits a plain string (or the Swagger 2 "file" type, which 3.1 does not have).
//
// Usage: go run ./scripts/openapi-fix api/openapi/swagger.json
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
)

const qrPath = "/orgs/{orgID}/links/{linkID}/qr"

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: openapi-fix <swagger.json>")
		os.Exit(2)
	}
	if err := run(os.Args[1]); err != nil {
		fmt.Fprintln(os.Stderr, "openapi-fix:", err)
		os.Exit(1)
	}
}

func run(file string) error {
	raw, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	var spec map[string]any
	if err := json.Unmarshal(raw, &spec); err != nil {
		return fmt.Errorf("parse %s: %w", file, err)
	}
	if err := markQRBinary(spec); err != nil {
		return err
	}
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false) // keep <, > and & as written, like swag does
	enc.SetIndent("", "    ")
	if err := enc.Encode(spec); err != nil {
		return err
	}
	return os.WriteFile(file, out.Bytes(), 0o644)
}

// markQRBinary sets every media type of the QR 200 response to a binary string.
func markQRBinary(spec map[string]any) error {
	content, ok := dig(spec, "paths", qrPath, "get", "responses", "200", "content").(map[string]any)
	if !ok {
		return fmt.Errorf("no 200 response content for GET %s: was the route renamed?", qrPath)
	}
	for _, media := range content {
		m, ok := media.(map[string]any)
		if !ok {
			continue
		}
		m["schema"] = map[string]any{"type": "string", "format": "binary"}
	}
	return nil
}

// dig follows keys through nested objects and returns nil when one is missing.
func dig(v any, keys ...string) any {
	for _, k := range keys {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[k]
	}
	return v
}
