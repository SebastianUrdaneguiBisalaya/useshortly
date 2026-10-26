package auth

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRefreshRepo struct {
	tokens map[int64]*RefreshToken
	nextID int64
}

func newFakeRefreshRepo() *fakeRefreshRepo {
	return &fakeRefreshRepo{tokens: map[int64]*RefreshToken{}}
}

func (r *fakeRefreshRepo) Create(_ context.Context, t RefreshToken) (RefreshToken, error) {
	r.nextID++
	t.ID = r.nextID
	r.tokens[t.ID] = &t
	return t, nil
}

func (r *fakeRefreshRepo) FindByHash(_ context.Context, hash string) (RefreshToken, error) {
	for _, t := range r.tokens {
		if t.TokenHash == hash {
			return *t, nil
		}
	}
	return RefreshToken{}, ErrRefreshTokenNotFound
}

func (r *fakeRefreshRepo) Revoke(_ context.Context, id int64, at time.Time) (bool, error) {
	t, ok := r.tokens[id]
	if !ok {
		return false, ErrRefreshTokenNotFound
	}
	if t.RevokedAt != nil {
		return false, nil
	}
	t.RevokedAt = &at
	return true, nil
}

func (r *fakeRefreshRepo) RevokeForMember(_ context.Context, userID, tenantID int64, at time.Time) error {
	for _, t := range r.tokens {
		if t.UserID == userID && t.TenantID == tenantID && t.RevokedAt == nil {
			t.RevokedAt = &at
		}
	}
	return nil
}

func (r *fakeRefreshRepo) RevokeForUser(_ context.Context, userID int64, at time.Time) error {
	for _, t := range r.tokens {
		if t.UserID == userID && t.RevokedAt == nil {
			t.RevokedAt = &at
		}
	}
	return nil
}

var (
	ctx      = context.Background()
	fixedNow = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
)

func newRefresh() (*RefreshService, *fakeRefreshRepo) {
	repo := newFakeRefreshRepo()
	s := NewRefreshService(repo, 24*time.Hour)
	s.now = func() time.Time { return fixedNow }
	return s, repo
}

func TestIssueStoresOnlyTheHash(t *testing.T) {
	s, repo := newRefresh()
	g, err := s.Issue(ctx, 7)
	require.NoError(t, err)
	assert.Regexp(t, `^rft_[A-Za-z0-9_-]{43}$`, g.Token)
	assert.Equal(t, fixedNow.Add(24*time.Hour), g.ExpiresAt)

	require.Len(t, repo.tokens, 1)
	stored := repo.tokens[1]
	assert.EqualValues(t, 7, stored.UserID)
	assert.Zero(t, stored.TenantID)
	assert.Equal(t, fixedNow, stored.CreatedAt)
	assert.NotContains(t, stored.TokenHash, g.Token)
	assert.Len(t, stored.TokenHash, 64)
}

func TestIssuedTokensAreUnique(t *testing.T) {
	s, _ := newRefresh()
	a, _ := s.Issue(ctx, 7)
	b, _ := s.Issue(ctx, 7)
	assert.NotEqual(t, a.Token, b.Token)
}

func TestRotateReplacesTheToken(t *testing.T) {
	s, repo := newRefresh()
	first, _ := s.Issue(ctx, 7)

	userID, second, err := s.Rotate(ctx, first.Token)
	require.NoError(t, err)
	assert.EqualValues(t, 7, userID)
	assert.NotEqual(t, first.Token, second.Token)
	assert.NotNil(t, repo.tokens[1].RevokedAt, "the used token is revoked")
	assert.Nil(t, repo.tokens[2].RevokedAt)

	_, _, err = s.Rotate(ctx, second.Token)
	assert.NoError(t, err, "the new token works")
}

func TestRotateRejectsBadTokensWithTheSameError(t *testing.T) {
	s, repo := newRefresh()
	g, _ := s.Issue(ctx, 7)
	repo.tokens[1].ExpiresAt = fixedNow.Add(-time.Second)

	for name, token := range map[string]string{
		"expired":    g.Token,
		"unknown":    "rft_" + g.Token[4:len(g.Token)-1] + "x",
		"no prefix":  g.Token[4:],
		"empty":      "",
		"an api key": "usl_whatever",
	} {
		_, _, err := s.Rotate(ctx, token)
		assert.ErrorIs(t, err, ErrInvalidCredentials, name)
	}
}

func TestReusingARotatedTokenRevokesEverySessionOfTheUser(t *testing.T) {
	s, repo := newRefresh()
	laptop, _ := s.Issue(ctx, 7)
	phone, _ := s.Issue(ctx, 7)
	other, _ := s.Issue(ctx, 8)

	_, _, err := s.Rotate(ctx, laptop.Token)
	require.NoError(t, err)
	// The old laptop token is replayed (stolen): the thief and the owner both lose the session.
	_, _, err = s.Rotate(ctx, laptop.Token)
	assert.ErrorIs(t, err, ErrInvalidCredentials)

	_, _, err = s.Rotate(ctx, phone.Token)
	assert.ErrorIs(t, err, ErrInvalidCredentials, "the phone session died too")
	_, _, err = s.Rotate(ctx, other.Token)
	assert.NoError(t, err, "other users are untouched")
	for _, tok := range repo.tokens {
		if tok.UserID == 7 {
			assert.NotNil(t, tok.RevokedAt)
		}
	}
}

func TestRotateKeepsTheTenantOfTheToken(t *testing.T) {
	s, repo := newRefresh()
	_, err := repo.Create(ctx, RefreshToken{UserID: 7, TenantID: 3, TokenHash: hashRefresh("rft_x"), ExpiresAt: fixedNow.Add(time.Hour), CreatedAt: fixedNow})
	require.NoError(t, err)
	_, _, err = s.Rotate(ctx, "rft_x")
	require.NoError(t, err)
	assert.EqualValues(t, 3, repo.tokens[2].TenantID)
}

func TestRevoke(t *testing.T) {
	s, repo := newRefresh()
	g, _ := s.Issue(ctx, 7)
	require.NoError(t, s.Revoke(ctx, g.Token))
	assert.NotNil(t, repo.tokens[1].RevokedAt)
	_, _, err := s.Rotate(ctx, g.Token)
	assert.ErrorIs(t, err, ErrInvalidCredentials)

	assert.NoError(t, s.Revoke(ctx, g.Token), "twice is fine")
	assert.NoError(t, s.Revoke(ctx, "rft_unknown"), "unknown tokens are not an error")
}

func TestRevokeForMemberAndUser(t *testing.T) {
	s, repo := newRefresh()
	_, _ = s.Issue(ctx, 7)
	_, err := repo.Create(ctx, RefreshToken{UserID: 7, TenantID: 3, TokenHash: "h3", ExpiresAt: fixedNow.Add(time.Hour), CreatedAt: fixedNow})
	require.NoError(t, err)

	require.NoError(t, s.RevokeForMember(ctx, 7, 3))
	assert.Nil(t, repo.tokens[1].RevokedAt)
	assert.NotNil(t, repo.tokens[2].RevokedAt)

	require.NoError(t, s.RevokeForUser(ctx, 7))
	assert.NotNil(t, repo.tokens[1].RevokedAt)
	assert.Equal(t, fixedNow, *repo.tokens[1].RevokedAt, "revocation uses the service clock")
}

func TestRefreshClockAdvancesAndIsUTC(t *testing.T) {
	s := NewRefreshService(nil, time.Hour)
	a := s.now()
	time.Sleep(5 * time.Millisecond)
	assert.True(t, s.now().After(a))
	assert.Equal(t, time.UTC, a.Location())
}
