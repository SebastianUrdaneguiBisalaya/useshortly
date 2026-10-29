// Package handler holds the HTTP handlers: they parse the request, call a domain service
// and map the result or error to a response. No business logic lives here.
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

const maxBodyBytes = 1 << 20

// Every JSON answer is an envelope: {"data": ...} on success, {"error": {...}} on failure.
// The status code travels only in the HTTP status line.

type dataBody struct {
	Data any `json:"data"`
	Meta any `json:"meta,omitempty"`
}

// pageMeta tells a client which window of a list it got and how big the whole list is.
type pageMeta struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
	Total  int `json:"total"`
} // @name PageMeta

// FieldError points at one invalid field of the request.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
} // @name FieldError

type errorBody struct {
	Error struct {
		Code    string       `json:"code"`
		Message string       `json:"message"`
		Details []FieldError `json:"details,omitempty"`
	} `json:"error"`
} // @name ErrorResponse

// writeJSON encodes before writing anything, so an encoding failure can still become a clean 500
// instead of a truncated body under an already-sent status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		slog.Error("encode response", "error", err)
		status = http.StatusInternalServerError
		b = []byte(`{"error":{"code":"internal_error","message":"something went wrong"}}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := w.Write(append(b, '\n')); err != nil {
		slog.Error("write response", "error", err)
	}
}

// writeData answers a success with the payload under "data".
func writeData(w http.ResponseWriter, status int, v any) {
	writeJSON(w, status, dataBody{Data: v})
}

// writePage answers a list under "data" with the window and the total under "meta".
func writePage(w http.ResponseWriter, items any, p page.Params, total int) {
	writeJSON(w, http.StatusOK, dataBody{Data: items, Meta: pageMeta{Limit: p.Limit, Offset: p.Offset, Total: total}})
}

func WriteAPIError(w http.ResponseWriter, status int, code, message string) {
	WriteAPIErrorDetails(w, status, code, message, nil)
}

// WriteAPIErrorDetails is WriteAPIError plus per-field details, for validation failures.
func WriteAPIErrorDetails(w http.ResponseWriter, status int, code, message string, details []FieldError) {
	var b errorBody
	b.Error.Code, b.Error.Message, b.Error.Details = code, message, details
	writeJSON(w, status, b)
}

// decode reads a JSON body strictly: application/json only, bounded size, no unknown fields, a
// single value. On failure it has already answered and returns false.
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		WriteAPIError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "the Content-Type must be application/json")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeDecodeError(w, err)
		return false
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeDecodeError(w, err)
			return false
		}
		WriteAPIError(w, http.StatusBadRequest, "invalid_body", "the request body must hold a single JSON value")
		return false
	}
	return true
}

// writeDecodeError tells apart the ways a body can be wrong, so clients can react to each.
func writeDecodeError(w http.ResponseWriter, err error) {
	var (
		tooBig  *http.MaxBytesError
		syntax  *json.SyntaxError
		typeErr *json.UnmarshalTypeError
	)
	switch {
	case errors.As(err, &tooBig):
		WriteAPIError(w, http.StatusRequestEntityTooLarge, "body_too_large",
			"the request body must be at most "+strconv.FormatInt(tooBig.Limit, 10)+" bytes")
	case errors.Is(err, io.EOF):
		WriteAPIError(w, http.StatusBadRequest, "empty_body", "the request body is empty")
	case errors.As(err, &syntax), errors.Is(err, io.ErrUnexpectedEOF):
		WriteAPIError(w, http.StatusBadRequest, "malformed_json", "the request body is not valid JSON")
	case errors.As(err, &typeErr):
		WriteAPIErrorDetails(w, http.StatusBadRequest, "invalid_field_type", "a field has the wrong type",
			[]FieldError{{Field: typeErr.Field, Message: "expected " + typeErr.Type.String()}})
	default:
		if name, ok := strings.CutPrefix(err.Error(), "json: unknown field "); ok {
			name = strings.Trim(name, `"`)
			WriteAPIErrorDetails(w, http.StatusBadRequest, "unknown_field", "the body has a field this endpoint does not accept",
				[]FieldError{{Field: name, Message: "unknown field"}})
			return
		}
		WriteAPIError(w, http.StatusBadRequest, "invalid_body", "the request body is not valid for this endpoint")
	}
}

// pageParams reads ?limit= and ?offset=. Absent ones take the defaults and a limit above the max
// is capped; anything that is not a non-negative integer (or a limit below 1) is a 400.
func pageParams(w http.ResponseWriter, r *http.Request) (page.Params, bool) {
	var p page.Params
	q := r.URL.Query()
	for _, f := range []struct {
		name string
		dst  *int
		min  int
	}{{"limit", &p.Limit, 1}, {"offset", &p.Offset, 0}} {
		raw := q.Get(f.name)
		if raw == "" {
			continue
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n < f.min {
			WriteAPIErrorDetails(w, http.StatusBadRequest, "invalid_pagination", "limit and offset must be integers, limit at least 1 and offset at least 0",
				[]FieldError{{Field: f.name, Message: "invalid value"}})
			return page.Params{}, false
		}
		*f.dst = n
	}
	return p.Normalize(), true
}

// idParam reads a positive integer path variable; a bad one is a 404, like any unknown resource.
func idParam(w http.ResponseWriter, r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(mux.Vars(r)[name], 10, 64)
	if err != nil || id <= 0 {
		WriteAPIError(w, http.StatusNotFound, "not_found", "resource not found")
		return 0, false
	}
	return id, true
}

// queryID reads an optional positive integer query value; absent is nil and a bad one is a 400.
func queryID(w http.ResponseWriter, r *http.Request, name string) (*int64, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return nil, true
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		WriteAPIErrorDetails(w, http.StatusBadRequest, "invalid_filter", "the filter must be a positive integer id",
			[]FieldError{{Field: name, Message: "invalid value"}})
		return nil, false
	}
	return &id, true
}

func formatTime(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func formatTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := formatTime(*t)
	return &s
}

func logInternal(r *http.Request, err error) {
	slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
}
