// Package qr draws QR codes with rsc.io/qr, which only encodes the module matrix: this adapter
// renders it as PNG or SVG with the quiet zone the standard asks for.
package qr

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"strconv"
	"strings"

	rscqr "rsc.io/qr"

	domain "github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/qr"
)

// quietZone is the white margin around the code, in modules.
const quietZone = 4

// Generator implements qr.Generator. Medium error correction survives a scuffed print.
type Generator struct{}

func NewGenerator() *Generator { return &Generator{} }

func (Generator) Generate(content string, format domain.Format, size int, style domain.Style) ([]byte, error) {
	code, err := rscqr.Encode(content, rscqr.M)
	if err != nil {
		return nil, fmt.Errorf("qr: encode: %w", err)
	}
	switch format {
	case domain.PNG:
		return renderPNG(code, size, style)
	case domain.SVG:
		return renderSVG(code, size, style), nil
	default:
		return nil, domain.ErrInvalidFormat
	}
}

// renderPNG scales each module by a whole number of pixels so edges stay sharp, so the image is
// the largest multiple of the module count that fits in size (never larger than size).
func renderPNG(code *rscqr.Code, size int, style domain.Style) ([]byte, error) {
	fg, bg := colors(style)
	modules := code.Size + 2*quietZone
	scale := max(size/modules, 1)
	side := modules * scale
	img := image.NewRGBA(image.Rect(0, 0, side, side))
	for y := 0; y < side; y++ {
		for x := 0; x < side; x++ {
			img.SetRGBA(x, y, bg)
		}
	}
	for y := 0; y < code.Size; y++ {
		for x := 0; x < code.Size; x++ {
			if !code.Black(x, y) {
				continue
			}
			px, py := (x+quietZone)*scale, (y+quietZone)*scale
			for dy := 0; dy < scale; dy++ {
				for dx := 0; dx < scale; dx++ {
					img.SetRGBA(px+dx, py+dy, fg)
				}
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("qr: png: %w", err)
	}
	return buf.Bytes(), nil
}

// renderSVG draws the black modules as one path of horizontal runs; the viewBox is in modules, so
// it scales to any size.
func renderSVG(code *rscqr.Code, size int, style domain.Style) []byte {
	fg, bg := hexColor(style.Foreground, "#000000"), hexColor(style.Background, "#ffffff")
	modules := code.Size + 2*quietZone
	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" shape-rendering="crispEdges">`,
		size, size, modules, modules)
	fmt.Fprintf(&b, `<rect width="%d" height="%d" fill="%s"/><path fill="%s" d="`, modules, modules, bg, fg)
	for y := 0; y < code.Size; y++ {
		for x := 0; x < code.Size; {
			if !code.Black(x, y) {
				x++
				continue
			}
			start := x
			for x < code.Size && code.Black(x, y) {
				x++
			}
			fmt.Fprintf(&b, "M%d %dh%dv1h-%dz", start+quietZone, y+quietZone, x-start, x-start)
		}
	}
	b.WriteString(`"/></svg>`)
	return []byte(b.String())
}

// colors reads the style as pixels, falling back to black on white for an empty or malformed color.
func colors(s domain.Style) (fg, bg color.RGBA) {
	return rgba(hexColor(s.Foreground, "#000000")), rgba(hexColor(s.Background, "#ffffff"))
}

// hexColor returns v if it is #rrggbb, else def. It is what keeps a stored value from breaking out
// of the SVG attribute it is written into.
func hexColor(v, def string) string {
	if len(v) != 7 || v[0] != '#' {
		return def
	}
	if _, err := strconv.ParseUint(v[1:], 16, 32); err != nil {
		return def
	}
	return strings.ToLower(v)
}

func rgba(hex string) color.RGBA {
	n, _ := strconv.ParseUint(hex[1:], 16, 32)
	return color.RGBA{R: uint8(n >> 16), G: uint8(n >> 8), B: uint8(n), A: 0xff}
}
