package router

import (
	"net/http"

	"github.com/gorilla/mux"
)

func NewRouter() http.Handler {
	r := mux.NewRouter()
	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	}).Methods(http.MethodGet)
	r.PathPrefix("/api/v1").Subrouter()
	return r
}
