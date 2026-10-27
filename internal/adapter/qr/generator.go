// Package qr draws QR codes with rsc.io/qr, which only encodes the module matrix: this adapter
// renders it as PNG or SVG with the quiet zone the standard asks for.
package qr

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"strings"

	rscqr "rsc.io/qr"

	domain "github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/qr"
)

// quietZone is the white margin around the code, in modules.
const quietZone = 4

// Generator implements qr.Generator. Medium error correction survives a scuffed print.
type Generator struct{}

func NewGenerator() *Generator { return &Generator{} }

func (Generator) Generate(content string, format domain.Format, size int) ([]byte, error) {
	code, err := rscqr.Encode(content, rscqr.M)
	if err != nil {
		return nil, fmt.Errorf("qr: encode: %w", err)
	}
	switch format {
	case domain.PNG:
		return renderPNG(code, size)
	case domain.SVG:
		return renderSVG(code, size), nil
	default:
		return nil, domain.ErrInvalidFormat
	}
}

// renderPNG scales each module by a whole number of pixels so edges stay sharp, so the image is
// the largest multiple of the module count that fits in size (never larger than size).
func renderPNG(code *rscqr.Code, size int) ([]byte, error) {
	modules := code.Size + 2*quietZone
	scale := max(size/modules, 1)
	side := modules * scale
	img := image.NewGray(image.Rect(0, 0, side, side))
	for i := range img.Pix {
		img.Pix[i] = 0xff
	}
	for y := 0; y < code.Size; y++ {
		for x := 0; x < code.Size; x++ {
			if !code.Black(x, y) {
				continue
			}
			px, py := (x+quietZone)*scale, (y+quietZone)*scale
			for dy := 0; dy < scale; dy++ {
				for dx := 0; dx < scale; dx++ {
					img.SetGray(px+dx, py+dy, color.Gray{Y: 0})
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
func renderSVG(code *rscqr.Code, size int) []byte {
	modules := code.Size + 2*quietZone
	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" shape-rendering="crispEdges">`,
		size, size, modules, modules)
	fmt.Fprintf(&b, `<rect width="%d" height="%d" fill="#fff"/><path fill="#000" d="`, modules, modules)
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
