package logsender

import (
	"bytes"
	"context"
	"log/slog"
	"testing"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var _ mailing.Sender = Sender{}

func TestSendLogsTheMessage(t *testing.T) {
	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })

	r, err := New().Send(context.Background(), mailing.Message{To: "ana@x.com", Subject: "Hi", Text: "code 123456"})
	require.NoError(t, err)
	assert.Equal(t, mailing.Receipt{Provider: "LOG"}, r)
	assert.Contains(t, buf.String(), "ana@x.com")
	assert.Contains(t, buf.String(), "123456")
}
