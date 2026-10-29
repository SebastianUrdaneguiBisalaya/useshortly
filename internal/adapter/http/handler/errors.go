package handler

import (
	"errors"
	"net/http"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/analytics"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/apikey"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/auth"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/campaign"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/domain"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/link"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/org"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/qr"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/unlockpage"
	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/user"
)

type apiError struct {
	status  int
	code    string
	message string
}

// httpErrors maps domain errors to HTTP. This is the only place that knows both sides.
var httpErrors = []struct {
	err error
	apiError
}{
	{user.ErrInvalidEmail, apiError{http.StatusBadRequest, "invalid_email", "the email is not valid"}},
	{user.ErrInvalidName, apiError{http.StatusBadRequest, "invalid_name", "the name is empty or too long"}},
	{user.ErrWeakPassword, apiError{http.StatusBadRequest, "weak_password", "the password must have 8 to 128 characters"}},
	{user.ErrEmailTaken, apiError{http.StatusConflict, "email_taken", "the email is already registered"}},
	{user.ErrProviderMismatch, apiError{http.StatusConflict, "provider_mismatch", "the email is registered with another sign-in method"}},
	{user.ErrInvalidCode, apiError{http.StatusBadRequest, "invalid_code", "the code is wrong or expired"}},
	{user.ErrTooManyAttempts, apiError{http.StatusTooManyRequests, "too_many_attempts", "too many wrong codes, request a new one"}},
	{user.ErrCodeTooSoon, apiError{http.StatusTooManyRequests, "code_too_soon", "a code was requested too recently, wait a minute"}},
	{user.ErrGoogleEmailNotVerified, apiError{http.StatusForbidden, "google_email_not_verified", "the Google email is not verified"}},
	{auth.ErrInvalidCredentials, apiError{http.StatusUnauthorized, "invalid_credentials", "invalid credentials"}},
	{auth.ErrTokenExpired, apiError{http.StatusUnauthorized, "token_expired", "the token expired"}},

	{org.ErrInvalidName, apiError{http.StatusBadRequest, "invalid_name", "the name is empty or too long"}},
	{org.ErrInvalidEmail, apiError{http.StatusBadRequest, "invalid_email", "an email is not valid"}},
	{org.ErrNameTaken, apiError{http.StatusConflict, "name_taken", "the organization name is taken"}},
	{org.ErrNotFound, apiError{http.StatusNotFound, "not_found", "organization not found"}},
	{org.ErrNotOwner, apiError{http.StatusForbidden, "not_owner", "only the owner of the organization can do this"}},
	{org.ErrNotMember, apiError{http.StatusForbidden, "not_member", "you are not a member of this organization"}},
	{org.ErrAlreadyMember, apiError{http.StatusConflict, "already_member", "already a member"}},
	{org.ErrCannotRemoveOwner, apiError{http.StatusConflict, "cannot_remove_owner", "the owner cannot be removed"}},
	{org.ErrInvitationNotFound, apiError{http.StatusNotFound, "invitation_not_found", "invitation not found"}},
	{org.ErrInvitationExists, apiError{http.StatusConflict, "invitation_exists", "a pending invitation already exists for this email"}},
	{org.ErrInvitationExpired, apiError{http.StatusGone, "invitation_expired", "the invitation expired"}},
	{org.ErrInvitationNotPending, apiError{http.StatusConflict, "invitation_not_pending", "the invitation was already answered"}},
	{org.ErrEmailNotVerified, apiError{http.StatusForbidden, "email_not_verified", "the email must be verified"}},

	{apikey.ErrNotFound, apiError{http.StatusNotFound, "not_found", "api key not found"}},
	{apikey.ErrExpired, apiError{http.StatusUnauthorized, "api_key_expired", "the api key expired"}},
	{apikey.ErrInvalidName, apiError{http.StatusBadRequest, "invalid_name", "the name is empty or too long"}},
	{apikey.ErrInvalidScope, apiError{http.StatusBadRequest, "invalid_scope", "the scope must be read or write"}},
	{apikey.ErrInvalidExpiry, apiError{http.StatusBadRequest, "invalid_expiry", "the expiration must be in the future"}},

	{analytics.ErrNotFound, apiError{http.StatusNotFound, "not_found", "link not found"}},
	{analytics.ErrInvalidRange, apiError{http.StatusBadRequest, "invalid_range", "from must not be after to, and the range is at most 366 days"}},

	{qr.ErrInvalidFormat, apiError{http.StatusBadRequest, "invalid_format", "the format must be png or svg"}},
	{qr.ErrInvalidSize, apiError{http.StatusBadRequest, "invalid_size", "the size must be a number of pixels between 64 and 1024"}},

	{domain.ErrNotFound, apiError{http.StatusNotFound, "not_found", "domain not found"}},
	{domain.ErrInvalidHost, apiError{http.StatusBadRequest, "invalid_host", "the host must be a domain name such as go.example.com, without scheme, port or path"}},
	{domain.ErrHostTaken, apiError{http.StatusConflict, "host_taken", "the host is already registered"}},
	{domain.ErrNotVerified, apiError{http.StatusConflict, "domain_not_verified", "the domain must be verified first"}},
	{domain.ErrVerificationFailed, apiError{http.StatusUnprocessableEntity, "verification_failed", "the DNS TXT record was not found, check its name and value (DNS changes can take a while)"}},
	{domain.ErrLookupFailed, apiError{http.StatusServiceUnavailable, "dns_unavailable", "the DNS lookup failed, try again"}},

	{link.ErrInvalidURL, apiError{http.StatusBadRequest, "invalid_url", "the url must be http(s) and at most 255 characters"}},
	{link.ErrInvalidAlias, apiError{http.StatusBadRequest, "invalid_alias", "the alias must be 3 to 15 letters, digits, - or _, not 7 characters long and not a reserved word"}},
	{link.ErrAliasTaken, apiError{http.StatusConflict, "alias_taken", "the alias is already in use"}},
	{link.ErrInvalidExpiry, apiError{http.StatusBadRequest, "invalid_expiry", "expires_at must be in the future"}},
	{link.ErrInvalidMaxClicks, apiError{http.StatusBadRequest, "invalid_max_clicks", "max_clicks must be greater than 0"}},
	{campaign.ErrNotFound, apiError{http.StatusNotFound, "not_found", "campaign not found"}},
	{campaign.ErrChannelNotFound, apiError{http.StatusNotFound, "channel_not_found", "channel not found"}},
	{campaign.ErrInvalidName, apiError{http.StatusBadRequest, "invalid_name", "the name must be 1 to 100 characters without control characters"}},
	{campaign.ErrInvalidDescription, apiError{http.StatusBadRequest, "invalid_description", "the description must be at most 500 characters"}},
	{campaign.ErrNameTaken, apiError{http.StatusConflict, "name_taken", "the organization already has a campaign with that name"}},
	{campaign.ErrInvalidChannelName, apiError{http.StatusBadRequest, "invalid_name", "the channel name must be 1 to 50 characters without control characters"}},
	{campaign.ErrChannelNameTaken, apiError{http.StatusConflict, "name_taken", "the campaign already has a channel with that name"}},
	{campaign.ErrTooManyChannels, apiError{http.StatusConflict, "too_many_channels", "a campaign has at most 100 channels"}},
	{campaign.ErrInvalidRange, apiError{http.StatusBadRequest, "invalid_range", "from must not be after to"}},
	{unlockpage.ErrNotFound, apiError{http.StatusNotFound, "not_found", "unlock page not found"}},
	{unlockpage.ErrInvalidHTML, apiError{http.StatusBadRequest, "invalid_html", "the page is empty or larger than 64 KB"}},

	{link.ErrInvalidQRColor, apiError{http.StatusBadRequest, "invalid_qr_color", "colors must be #rrggbb"}},
	{link.ErrLowQRContrast, apiError{http.StatusBadRequest, "low_qr_contrast", "the foreground must be darker than the background, with enough contrast to scan"}},
	{link.ErrInvalidLogoURL, apiError{http.StatusBadRequest, "invalid_logo_url", "the logo must be an https URL of at most 255 characters"}},
	{link.ErrInvalidPassword, apiError{http.StatusBadRequest, "invalid_password", "the password must be 4 to 64 characters"}},
	{link.ErrPasswordRequired, apiError{http.StatusUnauthorized, "password_required", "this link is protected, unlock it with its password"}},
	{link.ErrWrongPassword, apiError{http.StatusUnauthorized, "wrong_password", "the password is wrong"}},
	{link.ErrTooManyAttempts, apiError{http.StatusTooManyRequests, "too_many_attempts", "too many attempts, wait before trying again (see the Retry-After header)"}},
	{link.ErrCampaignsDisabled, apiError{http.StatusBadRequest, "campaigns_disabled", "campaigns are not enabled"}},
	{link.ErrCampaignURLTooLong, apiError{http.StatusBadRequest, "campaign_url_too_long", "the url plus the campaign utm parameters must be at most 255 characters"}},
	{link.ErrDomainsDisabled, apiError{http.StatusBadRequest, "domains_disabled", "custom domains are not enabled"}},
	{link.ErrNotFound, apiError{http.StatusNotFound, "not_found", "link not found"}},
	{link.ErrExpired, apiError{http.StatusGone, "link_expired", "the link expired"}},
	{link.ErrCodeTaken, apiError{http.StatusServiceUnavailable, "code_unavailable", "could not allocate a short code, try again"}},
}

// WriteError answers with the mapped status, or a generic 500 that hides the details.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	for _, m := range httpErrors {
		if errors.Is(err, m.err) {
			WriteAPIError(w, m.status, m.code, m.message)
			return
		}
	}
	logInternal(r, err)
	WriteAPIError(w, http.StatusInternalServerError, "internal_error", "something went wrong")
}
