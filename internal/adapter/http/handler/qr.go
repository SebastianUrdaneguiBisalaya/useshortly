package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/qr"
)

type QRHandler struct {
	links   *link.Service
	qr      *qr.Service
	baseURL string // public URL short links are served from
}

func NewQRHandler(links *link.Service, qr *qr.Service, baseURL string) *QRHandler {
	return &QRHandler{links: links, qr: qr, baseURL: strings.TrimRight(baseURL, "/")}
}

// Get answers the QR code of a link of the organization as an image of its short URL. ?format=
// is png (default) or svg and ?size= the pixels on a side (64 to 1024, default 256).
//
//	@Summary		QR code of a link
//	@Description	An image of the short URL, not JSON. Needs a JWT or an API key with the read scope.
//	@Tags			qr
//	@Produce		image/png,image/svg+xml
//	@Security		BearerAuth
//	@Param			orgID	path		int		true	"Organization id"
//	@Param			linkID	path		int		true	"Link id"
//	@Param			format	query		string	false	"Image format"	Enums(png, svg)	default(png)
//	@Param			size	query		int		false	"Pixels on a side"	minimum(64)	maximum(1024)	default(256)
//	@Success		200		{string}	string	"Image bytes"
//	@Failure	400	{object}	ErrorResponse
//	@Failure	401	{object}	ErrorResponse
//	@Failure	403	{object}	ErrorResponse
//	@Failure	404	{object}	ErrorResponse
//	@Failure	429	{object}	ErrorResponse
//	@Router			/orgs/{orgID}/links/{linkID}/qr [get]
func (h *QRHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenant, ok := tenantFrom(w, r)
	if !ok {
		return
	}
	linkID, ok := idParam(w, r, "linkID")
	if !ok {
		return
	}
	size := 0
	if raw := r.URL.Query().Get("size"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			WriteError(w, r, qr.ErrInvalidSize)
			return
		}
		size = n
	}
	l, err := h.links.Get(r.Context(), tenant.ID, linkID)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	img, format, err := h.qr.Render(shortURL(h.baseURL, l), qr.Format(r.URL.Query().Get("format")), size)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", format.ContentType())
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(img)
}
