-- Per-link QR style: hex colors (#rrggbb) and an optional logo (https URL) drawn in the middle.
-- NULL means the default: black on white, no logo.
ALTER TABLE links ADD COLUMN qr_foreground TEXT CHECK (qr_foreground IS NULL OR length(qr_foreground) = 7);
ALTER TABLE links ADD COLUMN qr_background TEXT CHECK (qr_background IS NULL OR length(qr_background) = 7);
ALTER TABLE links ADD COLUMN qr_logo_url TEXT CHECK (qr_logo_url IS NULL OR length(qr_logo_url) <= 255);
