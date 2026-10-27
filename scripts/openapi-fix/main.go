// Command openapi-fix patches what swag cannot express in the spec it generates, so the spec says
// what the API really does. `make openapi` runs it right after `swag init`.
//
// Usage: go run ./scripts/openapi-fix api/openapi/swagger.json
//
// To fix something else, add a Fix to the fixes list below: use a ready-made one
// (binaryResponse) or write a function that edits the spec. A fix returns an error when what it
// patches is missing, so a renamed route fails the build instead of silently losing its fix.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Spec is the OpenAPI document decoded as generic JSON.
type Spec = map[string]any

// Fix edits the spec in place.
type Fix struct {
	Name  string
	Apply func(Spec) error
}

// fixes run in order.
var fixes = []Fix{
	// The QR is an image; swag writes it as a plain string (or the Swagger 2 "file" type).
	binaryResponse("GET", "/orgs/{orgID}/links/{linkID}/qr", "200"),
}

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
	var spec Spec
	if err := json.Unmarshal(raw, &spec); err != nil {
		return fmt.Errorf("parse %s: %w", file, err)
	}
	if err := apply(spec, fixes); err != nil {
		return err
	}
	out, err := encode(spec)
	if err != nil {
		return err
	}
	return os.WriteFile(file, out, 0o644)
}

func apply(spec Spec, fixes []Fix) error {
	for _, f := range fixes {
		if err := f.Apply(spec); err != nil {
			return fmt.Errorf("%s: %w", f.Name, err)
		}
	}
	return nil
}

func encode(spec Spec) ([]byte, error) {
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false) // keep <, > and & as written, like swag does
	enc.SetIndent("", "    ")
	if err := enc.Encode(spec); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// binaryResponse makes every media type of a response a binary string, which is how OpenAPI 3.1
// describes a file or an image.
func binaryResponse(method, path, status string) Fix {
	name := fmt.Sprintf("binary response of %s %s (%s)", method, path, status)
	return Fix{Name: name, Apply: func(spec Spec) error {
		resp, err := response(spec, method, path, status)
		if err != nil {
			return err
		}
		content, ok := resp["content"].(map[string]any)
		if !ok {
			return fmt.Errorf("the response has no content")
		}
		for _, media := range content {
			if m, ok := media.(map[string]any); ok {
				m["schema"] = map[string]any{"type": "string", "format": "binary"}
			}
		}
		return nil
	}}
}

// operation returns the operation object of a method and path, for fixes that edit it.
func operation(spec Spec, method, path string) (map[string]any, error) {
	op, ok := dig(spec, "paths", path, strings.ToLower(method)).(map[string]any)
	if !ok {
		return nil, fmt.Errorf("no operation %s %s: was the route renamed?", method, path)
	}
	return op, nil
}

// response returns one response object of an operation.
func response(spec Spec, method, path, status string) (map[string]any, error) {
	op, err := operation(spec, method, path)
	if err != nil {
		return nil, err
	}
	resp, ok := dig(op, "responses", status).(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s %s has no %s response", method, path, status)
	}
	return resp, nil
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
