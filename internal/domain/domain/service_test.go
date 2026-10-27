package domain

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/page"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	domains map[int64]Domain
	next    int64
}

func newFakeRepo() *fakeRepo { return &fakeRepo{domains: map[int64]Domain{}} }

func (r *fakeRepo) Create(_ context.Context, d Domain) (Domain, error) {
	for _, o := range r.domains {
		if o.Host == d.Host {
			return Domain{}, ErrHostTaken
		}
	}
	r.next++
	d.ID = r.next
	r.domains[d.ID] = d
	return d, nil
}

func (r *fakeRepo) FindByID(_ context.Context, tenantID, id int64) (Domain, error) {
	d, ok := r.domains[id]
	if !ok || d.TenantID != tenantID {
		return Domain{}, ErrNotFound
	}
	return d, nil
}

func (r *fakeRepo) FindByHost(_ context.Context, host string) (Domain, error) {
	for _, d := range r.domains {
		if d.Host == host {
			return d, nil
		}
	}
	return Domain{}, ErrNotFound
}

func (r *fakeRepo) ListByTenant(context.Context, int64, page.Params) ([]Domain, int, error) {
	return nil, 0, nil
}

func (r *fakeRepo) MarkVerified(_ context.Context, tenantID, id int64, at time.Time) error {
	d, err := r.FindByID(context.Background(), tenantID, id)
	if err != nil {
		return err
	}
	d.VerifiedAt = &at
	r.domains[id] = d
	return nil
}

func (r *fakeRepo) Delete(_ context.Context, tenantID, id int64) error {
	if _, err := r.FindByID(context.Background(), tenantID, id); err != nil {
		return err
	}
	delete(r.domains, id)
	return nil
}

type fakeDNS struct {
	records map[string][]string
	err     error
}

func (f *fakeDNS) LookupTXT(_ context.Context, name string) ([]string, error) {
	return f.records[name], f.err
}

func newSvc() (*Service, *fakeRepo, *fakeDNS) {
	repo, dns := newFakeRepo(), &fakeDNS{records: map[string][]string{}}
	return NewService(repo, dns, "secret", "short.test"), repo, dns
}

var ctx = context.Background()

func TestNormalizeHost(t *testing.T) {
	good := map[string]string{
		"go.example.com":        "go.example.com",
		" Go.Example.COM. ":     "go.example.com",
		"a-b.example.co.uk":     "a-b.example.co.uk",
		"xn--bcher-kva.example": "xn--bcher-kva.example",
	}
	for in, want := range good {
		got, err := NormalizeHost(in)
		require.NoError(t, err, in)
		assert.Equal(t, want, got)
	}
	for _, in := range []string{
		"", "localhost", "1.2.3.4", "::1", "go.example.com:8080", "https://go.example.com", "go.example.com/x",
		"-a.example.com", "a-.example.com", "a..example.com", "under_score.example.com", "exa mple.com", "example.123",
	} {
		_, err := NormalizeHost(in)
		assert.ErrorIs(t, err, ErrInvalidHost, in)
	}
}

func TestAddAndVerify(t *testing.T) {
	s, _, dns := newSvc()
	d, err := s.Add(ctx, 1, "Go.Example.com")
	require.NoError(t, err)
	assert.Equal(t, "go.example.com", d.Host)
	assert.False(t, d.Verified())

	c := s.Challenge(d)
	assert.Equal(t, "TXT", c.Type)
	assert.Equal(t, "_useshortly-verify.go.example.com", c.Name)

	_, err = s.Verify(ctx, 1, d.ID)
	assert.ErrorIs(t, err, ErrVerificationFailed)

	dns.records[c.Name] = []string{"other", c.Value}
	got, err := s.Verify(ctx, 1, d.ID)
	require.NoError(t, err)
	assert.True(t, got.Verified())
	assert.NoError(t, s.RequireVerified(ctx, 1, d.ID))

	// Verifying again changes nothing, even if the record is gone.
	delete(dns.records, c.Name)
	again, err := s.Verify(ctx, 1, d.ID)
	require.NoError(t, err)
	assert.True(t, again.VerifiedAt.Equal(*got.VerifiedAt))
}

func TestTokenIsPerTenantAndHost(t *testing.T) {
	s, _, _ := newSvc()
	a := s.Challenge(Domain{TenantID: 1, Host: "go.example.com"})
	assert.NotEqual(t, a.Value, s.Challenge(Domain{TenantID: 2, Host: "go.example.com"}).Value)
	assert.NotEqual(t, a.Value, s.Challenge(Domain{TenantID: 1, Host: "x.example.com"}).Value)
	other := NewService(newFakeRepo(), &fakeDNS{}, "another", "")
	assert.NotEqual(t, a.Value, other.Challenge(Domain{TenantID: 1, Host: "go.example.com"}).Value)
}

func TestVerifyFailures(t *testing.T) {
	s, _, dns := newSvc()
	d, _ := s.Add(ctx, 1, "go.example.com")

	_, err := s.Verify(ctx, 2, d.ID)
	assert.ErrorIs(t, err, ErrNotFound, "another tenant cannot verify it")

	dns.err = errors.New("timeout")
	_, err = s.Verify(ctx, 1, d.ID)
	assert.ErrorIs(t, err, ErrLookupFailed)

	// The record meant for another tenant does not verify this one.
	dns.err = nil
	dns.records["_useshortly-verify.go.example.com"] = []string{s.Challenge(Domain{TenantID: 2, Host: "go.example.com"}).Value}
	_, err = s.Verify(ctx, 1, d.ID)
	assert.ErrorIs(t, err, ErrVerificationFailed)
}

func TestAddRefusals(t *testing.T) {
	s, _, dns := newSvc()
	_, err := s.Add(ctx, 1, "short.test")
	assert.ErrorIs(t, err, ErrHostTaken, "the instance's host is reserved")
	_, err = s.Add(ctx, 1, "nope")
	assert.ErrorIs(t, err, ErrInvalidHost)

	first, err := s.Add(ctx, 1, "go.example.com")
	require.NoError(t, err)
	_, err = s.Add(ctx, 1, "go.example.com")
	assert.ErrorIs(t, err, ErrHostTaken, "own duplicate")
	_, err = s.Add(ctx, 2, "go.example.com")
	assert.ErrorIs(t, err, ErrHostTaken, "someone else's, and there is no proof")

	// A verified domain can never be taken over.
	dns.records["_useshortly-verify.go.example.com"] = []string{s.Challenge(first).Value}
	_, err = s.Verify(ctx, 1, first.ID)
	require.NoError(t, err)
	dns.records["_useshortly-verify.go.example.com"] = []string{s.Challenge(Domain{TenantID: 2, Host: "go.example.com"}).Value}
	_, err = s.Add(ctx, 2, "go.example.com")
	assert.ErrorIs(t, err, ErrHostTaken)
}

func TestUnverifiedClaimDoesNotLockOutTheRealOwner(t *testing.T) {
	s, repo, dns := newSvc()
	squat, err := s.Add(ctx, 1, "go.example.com")
	require.NoError(t, err)

	dns.records["_useshortly-verify.go.example.com"] = []string{s.Challenge(Domain{TenantID: 2, Host: "go.example.com"}).Value}
	mine, err := s.Add(ctx, 2, "go.example.com")
	require.NoError(t, err, "the owner proves control, so the squatter's claim is dropped")
	assert.EqualValues(t, 2, mine.TenantID)
	assert.NotContains(t, repo.domains, squat.ID)
}

func TestFindVerifiedAndRequireVerified(t *testing.T) {
	s, _, dns := newSvc()
	d, _ := s.Add(ctx, 1, "go.example.com")

	_, err := s.FindVerified(ctx, "go.example.com")
	assert.ErrorIs(t, err, ErrNotFound, "unverified hosts serve nothing")
	assert.ErrorIs(t, s.RequireVerified(ctx, 1, d.ID), ErrNotVerified)
	assert.ErrorIs(t, s.RequireVerified(ctx, 2, d.ID), ErrNotFound)

	dns.records["_useshortly-verify.go.example.com"] = []string{s.Challenge(d).Value}
	_, err = s.Verify(ctx, 1, d.ID)
	require.NoError(t, err)
	got, err := s.FindVerified(ctx, "GO.example.com")
	require.NoError(t, err)
	assert.Equal(t, d.ID, got.ID)
	_, err = s.FindVerified(ctx, "not a host")
	assert.ErrorIs(t, err, ErrNotFound)
}
