package mailing

import (
	"errors"
	"fmt"
)

var (
	ErrTemplateNotFound = errors.New("mailing: template not found")
	ErrInvalidRecipient = errors.New("mailing: invalid recipient")
)

// ErrorType is a provider-independent category, so failures can be told apart (and, later,
// retried or alerted on) without knowing which provider produced them.
type ErrorType string

const (
	ErrorTypeRateLimit  ErrorType = "rate_limit" // too many requests; try again later
	ErrorTypeValidation ErrorType = "validation" // the provider rejected the request itself
	ErrorTypeAuth       ErrorType = "auth"       // bad or restricted credentials
	ErrorTypeNetwork    ErrorType = "network"    // no answer: timeout, cancelled, unreachable
	ErrorTypeProvider   ErrorType = "provider"   // any other provider-side failure (5xx...)
	ErrorTypeUnknown    ErrorType = "unknown"    // an error that does not say where it came from
)

// ProviderError is how a Sender reports a failed send. Code is the provider's own
// identifier for the failure (for Resend, its error name such as "validation_error",
// or the HTTP status when it gives none); Message is what the provider said.
type ProviderError struct {
	Type    ErrorType
	Code    string
	Message string
	Err     error // the underlying error, kept for errors.Is / errors.As
}

func (e *ProviderError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("%s: %s", e.Type, e.Message)
	}
	return fmt.Sprintf("%s (%s): %s", e.Type, e.Code, e.Message)
}

func (e *ProviderError) Unwrap() error { return e.Err }

// asProviderError gives any error the structured form for the log.
func asProviderError(err error) *ProviderError {
	var pe *ProviderError
	if errors.As(err, &pe) {
		return pe
	}
	return &ProviderError{Type: ErrorTypeUnknown, Message: err.Error(), Err: err}
}
