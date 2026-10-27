package qr

import (
	"bytes"
	"image"
	"image/png"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	rscqr "rsc.io/qr"

	domain "github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/qr"
)

const content = "https://short.test/abc1234"

func TestPNG(t *testing.T) {
	data, err := NewGenerator().Generate(content, domain.PNG, 256)
	require.NoError(t, err)
	img, err := png.Decode(bytes.NewReader(data))
	require.NoError(t, err)

	b := img.Bounds()
	assert.Equal(t, b.Dx(), b.Dy(), "square")
	assert.LessOrEqual(t, b.Dx(), 256)
	assert.Greater(t, b.Dx(), 256-40, "close to the size asked: only whole modules are drawn")

	code, err := rscqr.Encode(content, rscqr.M)
	require.NoError(t, err)
	scale := b.Dx() / (code.Size + 2*quietZone)
	for _, p := range []image.Point{{0, 0}, {b.Dx() - 1, b.Dy() - 1}, {b.Dx() - 1, 0}} {
		r, _, _, _ := img.At(p.X, p.Y).RGBA()
		assert.Equal(t, uint32(0xffff), r, "the quiet zone is white at %v", p)
	}
	// Every module is drawn with the right color, scaled.
	for y := 0; y < code.Size; y++ {
		for x := 0; x < code.Size; x++ {
			r, _, _, _ := img.At((x+quietZone)*scale+scale/2, (y+quietZone)*scale+scale/2).RGBA()
			assert.Equal(t, code.Black(x, y), r == 0, "module %d,%d", x, y)
		}
	}
}

func TestPNGNeverExceedsTheSize(t *testing.T) {
	for _, size := range []int{domain.MinSize, 100, 256, domain.MaxSize} {
		data, err := NewGenerator().Generate(content, domain.PNG, size)
		require.NoError(t, err)
		cfg, err := png.DecodeConfig(bytes.NewReader(data))
		require.NoError(t, err)
		if size >= 150 {
			assert.LessOrEqual(t, cfg.Width, size, "size %d", size)
		}
		assert.Positive(t, cfg.Width)
	}
}

func TestSVG(t *testing.T) {
	data, err := NewGenerator().Generate(content, domain.SVG, 300)
	require.NoError(t, err)
	svg := string(data)
	assert.Contains(t, svg, `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"`)
	assert.Contains(t, svg, `fill="#000"`)
	assert.Contains(t, svg, "M")
	assert.True(t, len(svg) > 200)
	assert.Contains(t, svg, "</svg>")
}

func TestSameContentSameImage(t *testing.T) {
	a, err := NewGenerator().Generate(content, domain.PNG, 256)
	require.NoError(t, err)
	b, err := NewGenerator().Generate(content, domain.PNG, 256)
	require.NoError(t, err)
	assert.Equal(t, a, b)
}

func TestUnknownFormat(t *testing.T) {
	_, err := NewGenerator().Generate(content, "gif", 256)
	assert.ErrorIs(t, err, domain.ErrInvalidFormat)
}
