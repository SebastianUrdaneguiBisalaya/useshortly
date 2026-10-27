package middlewares

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/adapter/http/handler"
)

// statusRecorder remembers the status a handler answered with. Unwrap keeps http.ResponseController
// (flush, deadlines) working through it.
type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wroteHeader {
		s.status = code
		s.wroteHeader = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wroteHeader {
		s.status = http.StatusOK
		s.wroteHeader = true
	}
	return s.ResponseWriter.Write(b)
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// Recover turns a panic in a handler into a logged 500 instead of a dropped connection. It
// answers only if the handler had not started the response yet.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec, ok := w.(*statusRecorder)
		if !ok {
			rec = &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			w = rec
		}
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			// The server uses this one to abort a response on purpose.
			if v == http.ErrAbortHandler {
				panic(v)
			}
			slog.Error("panic in handler", "method", r.Method, "path", r.URL.Path, "panic", v, "stack", string(debug.Stack()))
			if !rec.wroteHeader {
				handler.WriteAPIError(rec, http.StatusInternalServerError, "internal_error", "something went wrong")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// RequestLog logs one line per request: method, path, status and duration. The query string is
// left out because it may carry secrets.
func RequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.status, "duration", time.Since(start))
	})
}
