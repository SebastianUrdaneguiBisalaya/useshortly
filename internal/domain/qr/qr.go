// Package qr is the contract for turning a link into a QR code image.
package qr

import "errors"

type Format string

const (
	PNG Format = "png"
	SVG Format = "svg"
)

const (
	DefaultSize = 256
	MinSize     = 64
	MaxSize     = 1024
)

var (
	ErrInvalidFormat = errors.New("qr: invalid format")
	ErrInvalidSize   = errors.New("qr: invalid size")
)

// Style holds the colors of a QR code as #rrggbb. An empty color is the default: black modules on white.
type Style struct {
	Foreground string
	Background string
}

// Generator draws content as a QR code of about size pixels on a side.
type Generator interface {
	Generate(content string, format Format, size int, style Style) ([]byte, error)
}

// ContentType is the media type of an image in the format.
func (f Format) ContentType() string {
	if f == SVG {
		return "image/svg+xml"
	}
	return "image/png"
}

// Service checks the request and delegates the drawing.
type Service struct {
	gen Generator
}

func NewService(gen Generator) *Service {
	return &Service{gen: gen}
}

// Render returns the image, drawn with style. An empty format means PNG and a zero size means DefaultSize.
func (s *Service) Render(content string, format Format, size int, style Style) ([]byte, Format, error) {
	if format == "" {
		format = PNG
	}
	if format != PNG && format != SVG {
		return nil, "", ErrInvalidFormat
	}
	if size == 0 {
		size = DefaultSize
	}
	if size < MinSize || size > MaxSize {
		return nil, "", ErrInvalidSize
	}
	img, err := s.gen.Generate(content, format, size, style)
	return img, format, err
}
