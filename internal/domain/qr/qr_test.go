package qr

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeGen struct {
	content string
	format  Format
	size    int
	err     error
}

func (f *fakeGen) Generate(content string, format Format, size int, _ Style) ([]byte, error) {
	f.content, f.format, f.size = content, format, size
	return []byte("img"), f.err
}

func TestRender(t *testing.T) {
	t.Run("defaults to a 256 px PNG", func(t *testing.T) {
		g := &fakeGen{}
		img, format, err := NewService(g).Render("http://x/abc", "", 0, Style{})
		require.NoError(t, err)
		assert.Equal(t, []byte("img"), img)
		assert.Equal(t, PNG, format)
		assert.Equal(t, 256, g.size)
		assert.Equal(t, "http://x/abc", g.content)
	})

	t.Run("passes format and size through", func(t *testing.T) {
		g := &fakeGen{}
		_, format, err := NewService(g).Render("c", SVG, MaxSize, Style{})
		require.NoError(t, err)
		assert.Equal(t, SVG, format)
		assert.Equal(t, MaxSize, g.size)
	})

	t.Run("rejects bad requests without drawing", func(t *testing.T) {
		for name, tt := range map[string]struct {
			format Format
			size   int
			want   error
		}{
			"unknown format": {"gif", 0, ErrInvalidFormat},
			"too small":      {PNG, MinSize - 1, ErrInvalidSize},
			"too big":        {PNG, MaxSize + 1, ErrInvalidSize},
			"negative":       {PNG, -5, ErrInvalidSize},
		} {
			g := &fakeGen{}
			_, _, err := NewService(g).Render("c", tt.format, tt.size, Style{})
			assert.ErrorIs(t, err, tt.want, name)
			assert.Empty(t, g.content, name)
		}
	})

	t.Run("propagates the generator error", func(t *testing.T) {
		boom := errors.New("boom")
		_, _, err := NewService(&fakeGen{err: boom}).Render("c", PNG, 0, Style{})
		assert.ErrorIs(t, err, boom)
	})
}

func TestContentType(t *testing.T) {
	assert.Equal(t, "image/png", PNG.ContentType())
	assert.Equal(t, "image/svg+xml", SVG.ContentType())
}
