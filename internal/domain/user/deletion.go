package user

import (
	"context"
	"errors"
	"time"

	"github.com/SebastianUrdaneguiBisalaya/useshortly/internal/domain/mailing"
)

// Waker tells the organization purger that deleted organizations are waiting.
type Waker interface {
	Kick()
}

// DeletionService deletes an account after the owner confirms with a code sent to their email.
type DeletionService struct {
	repo   Repository
	otp    *OTP
	mailer Mailer
	purger Waker
	now    func() time.Time
}

func NewDeletionService(repo Repository, otp *OTP, mailer Mailer, purger Waker) *DeletionService {
	return &DeletionService{repo: repo, otp: otp, mailer: mailer, purger: purger, now: func() time.Time { return time.Now().UTC() }}
}

// RequestCode emails the user a code that confirms deleting their account. It returns
// ErrCodeTooSoon if one was sent less than a minute ago. The email is best effort: if it
// fails the user asks again.
func (s *DeletionService) RequestCode(ctx context.Context, userID int64) error {
	u, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	code, err := s.otp.issue(ctx, PurposeDelete, u.Email, "")
	if err != nil {
		return err
	}
	_ = s.mailer.Send(ctx, mailing.Request{Code: mailing.TemplateAccountDeletion, To: u.Email, Data: codeData(u.FirstName, code)})
	return nil
}

// Delete checks the code and deletes the account in one transaction: the user, their sessions and
// memberships, and every organization they own (hidden at once, purged in the background). Links
// they created in organizations that outlive them stay. If the transaction fails nothing changed,
// but the code was spent, so the user asks for a new one.
func (s *DeletionService) Delete(ctx context.Context, userID int64, code string) error {
	u, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if _, err := s.otp.check(ctx, PurposeDelete, u.Email, code); err != nil {
		return err
	}
	if err := s.repo.DeleteWithOrganizations(ctx, userID, s.now()); err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if s.purger != nil {
		s.purger.Kick()
	}
	return nil
}
