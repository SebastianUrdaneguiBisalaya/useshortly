package hasher

import (
	"errors"
	"testing"
)

func TestHashVerify(t *testing.T) {
	h := &PBKDF2{iterations: 1000}
	hash, err := h.Hash("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := h.Verify(hash, "correct horse"); err != nil || !ok {
		t.Fatalf("Verify right password = %v, %v", ok, err)
	}
	if ok, err := h.Verify(hash, "wrong"); err != nil || ok {
		t.Fatalf("Verify wrong password = %v, %v", ok, err)
	}
}

func TestHashIsSalted(t *testing.T) {
	h := &PBKDF2{iterations: 1000}
	a, _ := h.Hash("same")
	b, _ := h.Hash("same")
	if a == b {
		t.Fatal("two hashes of the same password are identical")
	}
}

func TestVerifyMalformed(t *testing.T) {
	h := NewPBKDF2()
	for _, hash := range []string{"", "plain", "$bcrypt$10$a$b", "$pbkdf2-sha256$x$a$b", "$pbkdf2-sha256$1000$!!$b"} {
		if _, err := h.Verify(hash, "pw"); !errors.Is(err, ErrMalformedHash) {
			t.Errorf("Verify(%q) err = %v, want ErrMalformedHash", hash, err)
		}
	}
}

func TestVerifyUsesStoredIterations(t *testing.T) {
	hash, _ := (&PBKDF2{iterations: 1000}).Hash("pw")
	if ok, err := NewPBKDF2().Verify(hash, "pw"); err != nil || !ok {
		t.Fatalf("Verify = %v, %v", ok, err)
	}
}
