/** The shapes the API sends and receives, as TypeScript. Shown as-is in the docs, so they are written the way a client would declare them. */
export const API_TYPES = `// Every successful response wraps its payload in "data".
interface Envelope<T> {
  data: T;
}

interface Page<T> {
  data: T[];
  meta: { limit: number; offset: number; total: number };
}

interface ApiError {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
}

interface Link {
  id: number;
  code: string;
  short_url: string;
  domain_id: number | null;
  origin_url: string;
  expires_at: string | null; // RFC 3339, UTC
  max_clicks: number | null;
  protected: boolean;
  qr_style: QRStyle;
  created_at: string;
}

// null means the default: black on white, no logo.
interface QRStyle {
  foreground: string | null; // #rrggbb
  background: string | null; // #rrggbb
  logo_url: string | null; // https URL
}

interface LinkStats {
  link_id: number;
  from: string; // YYYY-MM-DD (UTC)
  to: string;
  total: number;
  previous_total: number; // same length, right before "from"
  daily: { date: string; clicks: number }[];
  by_hour: number[]; // 24 entries, UTC hour 0..23
  by_weekday: number[]; // 7 entries, 0 is Sunday
  countries: ClickCount[]; // ISO 3166-1 alpha-2, or "unknown"
  devices: ClickCount[]; // mobile | tablet | desktop | bot | unknown
  referrers: ClickCount[]; // a URL, or "direct"
}

interface ClickCount {
  name: string;
  clicks: number;
}

interface Domain {
  id: number;
  host: string;
  verified: boolean;
  verified_at: string | null;
  verification?: { type: "TXT"; name: string; value: string }; // left out once verified
  created_at: string;
}

interface UnlockPage {
  link_id: number | null; // null for the organization's page
  html: string;
  updated_at: string;
  updated_by: number;
}

interface UnlockPageEvent {
  link_id: number | null;
  user_id: number;
  action: string;
  at: string;
}`;
