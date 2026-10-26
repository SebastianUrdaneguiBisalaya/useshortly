package user

// PasswordHasher hides the hashing algorithm (argon2id, bcrypt, pbkdf2...) from the domain.
// Hash output must embed salt and parameters so Verify needs nothing else.
type PasswordHasher interface {
	Hash(password string) (string, error)
	// Verify reports whether password matches hash. A malformed hash is an error.
	Verify(hash, password string) (bool, error)
}
