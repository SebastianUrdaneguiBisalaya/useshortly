package user

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
)

type fakeRepo struct {
	users    map[int64]User
	accounts map[int64]Account
	nextID   int64
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{users: map[int64]User{}, accounts: map[int64]Account{}}
}

func (r *fakeRepo) Create(_ context.Context, u User, a Account) (User, error) {
	for _, e := range r.users {
		if strings.EqualFold(e.Email, u.Email) {
			return User{}, ErrEmailTaken
		}
	}
	r.nextID++
	u.ID, a.UserID = r.nextID, r.nextID
	r.users[u.ID], r.accounts[u.ID] = u, a
	return u, nil
}

func (r *fakeRepo) FindByEmail(_ context.Context, email string) (User, error) {
	for _, u := range r.users {
		if u.Email == email {
			return u, nil
		}
	}
	return User{}, ErrNotFound
}

func (r *fakeRepo) FindByID(_ context.Context, id int64) (User, error) {
	if u, ok := r.users[id]; ok {
		return u, nil
	}
	return User{}, ErrNotFound
}

func (r *fakeRepo) FindAccount(_ context.Context, userID int64, p Provider) (Account, error) {
	if a, ok := r.accounts[userID]; ok && a.Provider == p {
		return a, nil
	}
	return Account{}, ErrNotFound
}

type fakeHasher struct{}

func (fakeHasher) Hash(p string) (string, error) { return "hash:" + p, nil }
func (fakeHasher) Verify(h, p string) (bool, error) {
	return h == "hash:"+p, nil
}

type fakeTokens struct{}

func (fakeTokens) Generate(_ context.Context, id string) (auth.Token, error) {
	return auth.Token{Value: "tok:" + id, ExpiresAt: time.Unix(1000, 0)}, nil
}
func (fakeTokens) Validate(_ context.Context, t string) (string, error) {
	if id, ok := strings.CutPrefix(t, "tok:"); ok {
		return id, nil
	}
	return "", auth.ErrInvalidCredentials
}

func newService() (*Service, *fakeRepo) {
	repo := newFakeRepo()
	return NewService(repo, fakeHasher{}, fakeTokens{}), repo
}

var valid = RegisterInput{Email: "  Ana@Example.com ", Password: "s3cretpass", FirstName: "Ana", LastName: "Lopez"}

func TestRegister(t *testing.T) {
	svc, repo := newService()
	u, err := svc.Register(context.Background(), valid)
	if err != nil {
		t.Fatal(err)
	}
	if u.Email != "ana@example.com" || u.ID == 0 {
		t.Fatalf("user = %+v", u)
	}
	acc := repo.accounts[u.ID]
	if acc.Provider != ProviderDefault || acc.PasswordHash != "hash:s3cretpass" {
		t.Fatalf("account = %+v", acc)
	}
}

func TestRegisterValidation(t *testing.T) {
	tests := map[string]struct {
		mutate func(*RegisterInput)
		want   error
	}{
		"bad email":      {func(i *RegisterInput) { i.Email = "nope" }, ErrInvalidEmail},
		"display name":   {func(i *RegisterInput) { i.Email = "Ana <ana@example.com>" }, ErrInvalidEmail},
		"short password": {func(i *RegisterInput) { i.Password = "short" }, ErrWeakPassword},
		"long password":  {func(i *RegisterInput) { i.Password = strings.Repeat("a", 129) }, ErrWeakPassword},
		"empty name":     {func(i *RegisterInput) { i.FirstName = " " }, ErrInvalidName},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			svc, _ := newService()
			in := valid
			tc.mutate(&in)
			if _, err := svc.Register(context.Background(), in); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestRegisterEmailTaken(t *testing.T) {
	svc, _ := newService()
	if _, err := svc.Register(context.Background(), valid); err != nil {
		t.Fatal(err)
	}
	in := valid
	in.Email = "ANA@example.com"
	if _, err := svc.Register(context.Background(), in); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("err = %v, want ErrEmailTaken", err)
	}
}

func TestLogin(t *testing.T) {
	svc, _ := newService()
	u, _ := svc.Register(context.Background(), valid)
	s, err := svc.Login(context.Background(), "ANA@example.com", "s3cretpass")
	if err != nil {
		t.Fatal(err)
	}
	if s.User.ID != u.ID || s.Token.Value != "tok:1" {
		t.Fatalf("session = %+v", s)
	}
}

func TestLoginFailuresAreIndistinguishable(t *testing.T) {
	svc, _ := newService()
	svc.Register(context.Background(), valid)
	for name, c := range map[string][2]string{
		"wrong password": {"ana@example.com", "wrongpass1"},
		"unknown email":  {"who@example.com", "s3cretpass"},
		"invalid email":  {"nope", "s3cretpass"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := svc.Login(context.Background(), c[0], c[1]); !errors.Is(err, auth.ErrInvalidCredentials) {
				t.Fatalf("err = %v, want ErrInvalidCredentials", err)
			}
		})
	}
}

func TestLoginWithoutPasswordAccount(t *testing.T) {
	svc, repo := newService()
	u, _ := svc.Register(context.Background(), valid)
	repo.accounts[u.ID] = Account{UserID: u.ID, Provider: ProviderGoogle}
	if _, err := svc.Login(context.Background(), "ana@example.com", "s3cretpass"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("err = %v, want ErrInvalidCredentials", err)
	}
}

func TestAuthenticate(t *testing.T) {
	svc, _ := newService()
	u, _ := svc.Register(context.Background(), valid)
	s, _ := svc.Login(context.Background(), "ana@example.com", "s3cretpass")
	got, err := svc.Authenticate(context.Background(), s.Token.Value)
	if err != nil || got.ID != u.ID {
		t.Fatalf("Authenticate = %+v, %v", got, err)
	}
	if _, err := svc.Authenticate(context.Background(), "tok:99"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("deleted user err = %v", err)
	}
	if _, err := svc.Authenticate(context.Background(), "bad"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("bad token err = %v", err)
	}
}
