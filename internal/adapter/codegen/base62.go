package codegen

import (
	"crypto/rand"
	"math/big"
)

const (
	alphabet   = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	codeLength = 7
)

type Base62 struct {
	length int
}

func NewBase62() *Base62 {
	return &Base62{
		length: codeLength,
	}
}

func (g *Base62) Generate() (string, error) {
	max := big.NewInt(int64(len(alphabet)))
	buf := make([]byte, g.length)
	for i := range buf {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		buf[i] = alphabet[n.Int64()]
	}
	return string(buf), nil
}
