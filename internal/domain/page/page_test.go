package page

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalize(t *testing.T) {
	tests := []struct {
		name string
		in   Params
		want Params
	}{
		{"zero value gets the default", Params{}, Params{Limit: DefaultLimit}},
		{"negative limit gets the default", Params{Limit: -5}, Params{Limit: DefaultLimit}},
		{"limit above the max is capped", Params{Limit: MaxLimit + 1}, Params{Limit: MaxLimit}},
		{"negative offset becomes 0", Params{Limit: 10, Offset: -1}, Params{Limit: 10}},
		{"valid window is kept", Params{Limit: 10, Offset: 30}, Params{Limit: 10, Offset: 30}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.in.Normalize())
		})
	}
}
