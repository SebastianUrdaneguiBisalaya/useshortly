package apikey

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeRepo struct {
	keys    map[int64]APIKey
	nextID  int64
	touched map[int64]time.Time
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{keys: map[int64]APIKey{}, touched: map[int64]time.Time{}}
}

func (r *fakeRepo) Create(_ context.Context, k APIKey) (APIKey, error) {
	r.nextID++
	k.ID = r.nextID
	r.keys[k.ID] = k
	return k, nil
}

func (r *fakeRepo) ListByTenant(_ context.Context, tenantID int64) ([]APIKey, error) {
	var out []APIKey
	for _, k := range r.keys {
		if k.TenantID == tenantID {
			out = append(out, k)
		}
	}
	return out, nil
}

func (r *fakeRepo) Delete(_ context.Context, tenantID, id int64) error {
	if k, ok := r.keys[id]; ok && k.TenantID == tenantID {
		delete(r.keys, id)
		return nil
	}
	return ErrNotFound
}

func (r *fakeRepo) FindByHash(_ context.Context, hash string) (APIKey, error) {
	for _, k := range r.keys {
		if k.KeyHash == hash {
			return k, nil
		}
	}
	return APIKey{}, ErrNotFound
}

func (r *fakeRepo) TouchLastUsed(_ context.Context, id int64, at time.Time) error {
	r.touched[id] = at
	return nil
}

func TestCreateStoresOnlyHash(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	k, secret, err := svc.Create(context.Background(), 1, 7, " ci ", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(secret, "usl_") || k.Name != "ci" || k.TenantID != 1 || k.CreatedBy != 7 {
		t.Fatalf("key = %+v secret = %q", k, secret)
	}
	if k.KeyHash == secret || strings.Contains(k.KeyHash, secret) || k.Prefix != secret[:12] {
		t.Fatalf("stored key leaks the secret: %+v", k)
	}
}

func TestCreateValidation(t *testing.T) {
	svc := NewService(newFakeRepo())
	past := time.Now().Add(-time.Hour)
	if _, _, err := svc.Create(context.Background(), 1, 1, "  ", nil); !errors.Is(err, ErrInvalidName) {
		t.Fatalf("empty name err = %v", err)
	}
	if _, _, err := svc.Create(context.Background(), 1, 1, strings.Repeat("a", 101), nil); !errors.Is(err, ErrInvalidName) {
		t.Fatalf("long name err = %v", err)
	}
	if _, _, err := svc.Create(context.Background(), 1, 1, "x", &past); !errors.Is(err, ErrInvalidExpiry) {
		t.Fatalf("past expiry err = %v", err)
	}
}

func TestSecretsAreUnique(t *testing.T) {
	svc := NewService(newFakeRepo())
	_, a, _ := svc.Create(context.Background(), 1, 1, "a", nil)
	_, b, _ := svc.Create(context.Background(), 1, 1, "b", nil)
	if a == b {
		t.Fatal("two keys got the same secret")
	}
}

func TestAuthenticate(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	k, secret, _ := svc.Create(context.Background(), 1, 7, "ci", nil)
	got, err := svc.Authenticate(context.Background(), secret)
	if err != nil || got.ID != k.ID || got.TenantID != 1 {
		t.Fatalf("Authenticate = %+v, %v", got, err)
	}
	if repo.touched[k.ID].IsZero() {
		t.Fatal("last used not recorded")
	}
	for _, bad := range []string{"", "usl_wrong", "other_" + secret[4:]} {
		if _, err := svc.Authenticate(context.Background(), bad); !errors.Is(err, ErrNotFound) {
			t.Fatalf("Authenticate(%q) err = %v, want ErrNotFound", bad, err)
		}
	}
}

func TestAuthenticateExpired(t *testing.T) {
	svc := NewService(newFakeRepo())
	soon := time.Now().Add(time.Minute)
	_, secret, err := svc.Create(context.Background(), 1, 1, "tmp", &soon)
	if err != nil {
		t.Fatal(err)
	}
	svc.now = func() time.Time { return time.Now().Add(time.Hour) }
	if _, err := svc.Authenticate(context.Background(), secret); !errors.Is(err, ErrExpired) {
		t.Fatalf("err = %v, want ErrExpired", err)
	}
}

func TestDeleteIsScopedToTenant(t *testing.T) {
	svc := NewService(newFakeRepo())
	k, _, _ := svc.Create(context.Background(), 1, 1, "a", nil)
	if err := svc.Delete(context.Background(), 2, k.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant delete err = %v", err)
	}
	if err := svc.Delete(context.Background(), 1, k.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := svc.List(context.Background(), 1); len(list) != 0 {
		t.Fatalf("list = %+v", list)
	}
}
