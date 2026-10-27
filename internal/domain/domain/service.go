package domain

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"strings"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
)

const (
	maxHostLen  = 253
	maxLabelLen = 63
	// recordPrefix is prepended to the host to get the name of the TXT record to create.
	recordPrefix = "_useshortly-verify."
	// valuePrefix starts the value of that record.
	valuePrefix = "useshortly-verify="
)

// DNSResolver reads the TXT records of a name. A name without records is not an error: it
// returns none. Anything else (timeouts, a failing resolver) is an error.
type DNSResolver interface {
	LookupTXT(ctx context.Context, name string) ([]string, error)
}

// Challenge is the DNS record an owner creates to prove control of a host.
type Challenge struct {
	Type  string // always "TXT"
	Name  string
	Value string
}

type Service struct {
	repo     Repository
	dns      DNSResolver
	secret   []byte
	reserved string // the instance's own host, which no tenant can claim
	now      func() time.Time
}

// NewService builds the service. secret derives the verification tokens (nothing is stored, so
// it must stay the same between restarts); reservedHost is the host of the instance itself.
func NewService(repo Repository, dns DNSResolver, secret, reservedHost string) *Service {
	return &Service{
		repo:     repo,
		dns:      dns,
		secret:   []byte(secret),
		reserved: strings.ToLower(reservedHost),
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// Add registers host for the tenant. It starts unverified: the owner must create the DNS record
// of Challenge and then call Verify. Registering a host another tenant holds without having
// verified it succeeds if the new owner's record is already in place.
func (s *Service) Add(ctx context.Context, tenantID int64, host string) (Domain, error) {
	host, err := NormalizeHost(host)
	if err != nil {
		return Domain{}, err
	}
	if host == s.reserved {
		return Domain{}, ErrHostTaken
	}
	d := Domain{TenantID: tenantID, Host: host, CreatedAt: s.now()}
	created, err := s.repo.Create(ctx, d)
	if !errors.Is(err, ErrHostTaken) {
		return created, err
	}
	// Someone holds the host. An unverified claim must not lock out the real owner, who can prove it.
	existing, ferr := s.repo.FindByHost(ctx, host)
	if ferr != nil || existing.Verified() || existing.TenantID == tenantID {
		return Domain{}, ErrHostTaken
	}
	if ok, _ := s.recordPresent(ctx, tenantID, host); !ok {
		return Domain{}, ErrHostTaken
	}
	if err := s.repo.Delete(ctx, existing.TenantID, existing.ID); err != nil && !errors.Is(err, ErrNotFound) {
		return Domain{}, err
	}
	return s.repo.Create(ctx, d)
}

// Challenge returns the DNS record that proves the tenant controls the host.
func (s *Service) Challenge(d Domain) Challenge {
	return Challenge{Type: "TXT", Name: recordPrefix + d.Host, Value: valuePrefix + s.token(d.TenantID, d.Host)}
}

// token is derived from the secret, the tenant and the host, so it cannot be guessed and another
// tenant cannot reuse the one shown to this tenant.
func (s *Service) token(tenantID int64, host string) string {
	m := hmac.New(sha256.New, s.secret)
	fmt.Fprintf(m, "domain-verify:%d:%s", tenantID, host)
	return hex.EncodeToString(m.Sum(nil))[:32]
}

func (s *Service) recordPresent(ctx context.Context, tenantID int64, host string) (bool, error) {
	want := valuePrefix + s.token(tenantID, host)
	records, err := s.dns.LookupTXT(ctx, recordPrefix+host)
	if err != nil {
		return false, err
	}
	for _, r := range records {
		if strings.TrimSpace(r) == want {
			return true, nil
		}
	}
	return false, nil
}

// Verify checks the DNS record and, if it is there, marks the domain verified. Verifying a
// verified domain does nothing. ErrVerificationFailed means the record is not (yet) visible.
func (s *Service) Verify(ctx context.Context, tenantID, id int64) (Domain, error) {
	d, err := s.repo.FindByID(ctx, tenantID, id)
	if err != nil {
		return Domain{}, err
	}
	if d.Verified() {
		return d, nil
	}
	ok, err := s.recordPresent(ctx, tenantID, d.Host)
	if err != nil {
		return Domain{}, fmt.Errorf("%w: %s: %v", ErrLookupFailed, d.Host, err)
	}
	if !ok {
		return Domain{}, ErrVerificationFailed
	}
	at := s.now()
	if err := s.repo.MarkVerified(ctx, tenantID, id, at); err != nil {
		return Domain{}, err
	}
	d.VerifiedAt = &at
	return d, nil
}

func (s *Service) Get(ctx context.Context, tenantID, id int64) (Domain, error) {
	return s.repo.FindByID(ctx, tenantID, id)
}

func (s *Service) List(ctx context.Context, tenantID int64, p page.Params) ([]Domain, int, error) {
	return s.repo.ListByTenant(ctx, tenantID, p.Normalize())
}

// Delete removes the domain and, with it, the links served from it.
func (s *Service) Delete(ctx context.Context, tenantID, id int64) error {
	return s.repo.Delete(ctx, tenantID, id)
}

// FindVerified returns the verified domain that serves host. ErrNotFound covers both an unknown
// host and one that is not verified yet, so an unverified claim never serves anything.
func (s *Service) FindVerified(ctx context.Context, host string) (Domain, error) {
	host, err := NormalizeHost(host)
	if err != nil {
		return Domain{}, ErrNotFound
	}
	d, err := s.repo.FindByHost(ctx, host)
	if err != nil {
		return Domain{}, err
	}
	if !d.Verified() {
		return Domain{}, ErrNotFound
	}
	return d, nil
}

// RequireVerified returns nil if the tenant owns the domain and it is verified; ErrNotFound if
// it is not the tenant's, ErrNotVerified if it is but not verified yet. Links call it before
// they are served from a domain.
func (s *Service) RequireVerified(ctx context.Context, tenantID, id int64) error {
	d, err := s.repo.FindByID(ctx, tenantID, id)
	if err != nil {
		return err
	}
	if !d.Verified() {
		return ErrNotVerified
	}
	return nil
}

// NormalizeHost lowercases host, drops a trailing dot and checks it is a DNS name with at least
// two labels. IP addresses, ports and paths are refused.
func NormalizeHost(host string) (string, error) {
	h := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	if h == "" || len(h) > maxHostLen {
		return "", ErrInvalidHost
	}
	if _, err := netip.ParseAddr(h); err == nil {
		return "", ErrInvalidHost
	}
	labels := strings.Split(h, ".")
	if len(labels) < 2 {
		return "", ErrInvalidHost
	}
	for _, l := range labels {
		if l == "" || len(l) > maxLabelLen || l[0] == '-' || l[len(l)-1] == '-' {
			return "", ErrInvalidHost
		}
		for _, r := range l {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
				return "", ErrInvalidHost
			}
		}
	}
	// The last label is never all digits (1.2.3.4-like names are not hosts).
	if last := labels[len(labels)-1]; strings.Trim(last, "0123456789") == "" {
		return "", ErrInvalidHost
	}
	return h, nil
}
