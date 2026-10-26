// Package handler holds the HTTP handlers: they parse the request, call a domain service
// and map the result or error to a response. No business logic lives here.
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

const maxBodyBytes = 1 << 20

type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func WriteAPIError(w http.ResponseWriter, status int, code, message string) {
	var b errorBody
	b.Error.Code, b.Error.Message = code, message
	writeJSON(w, status, b)
}

// decode reads a JSON body strictly: bounded size, no unknown fields, a single value.
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		WriteAPIError(w, http.StatusBadRequest, "invalid_body", "the request body is not valid JSON for this endpoint")
		return false
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		WriteAPIError(w, http.StatusBadRequest, "invalid_body", "the request body must hold a single JSON value")
		return false
	}
	return true
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
