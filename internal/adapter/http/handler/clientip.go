package handler

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// clientIP is the visitor's address. By default it is the connection's remote address. With
// trustProxy it is the first X-Forwarded-For entry, the client as the proxy saw it: only enable
// that behind a proxy that sets the header, or any visitor could claim any address. If the
// header is missing or unreadable it falls back to the remote address; the zero Addr means unknown.
// ClientIP is the visitor's address as the rest of the application sees it; see clientIP.
func ClientIP(r *http.Request, trustProxy bool) netip.Addr { return clientIP(r, trustProxy) }

func clientIP(r *http.Request, trustProxy bool) netip.Addr {
	if trustProxy {
		if first, _, _ := strings.Cut(r.Header.Get("X-Forwarded-For"), ","); strings.TrimSpace(first) != "" {
			if ip, err := netip.ParseAddr(strings.TrimSpace(first)); err == nil {
				return ip.Unmap()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	return ip.Unmap()
}
