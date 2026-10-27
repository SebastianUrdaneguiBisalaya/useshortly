import type { Context, MiddlewareHandler } from "hono";

export const googleScript = "https://accounts.google.com/gsi/client";

export const newNonce = () => btoa(crypto.randomUUID());

/** A browser always sends Origin on a POST. Anything other than our own origin is not our own page. */
export function sameOrigin(publicUrl: string): MiddlewareHandler {
  const origin = new URL(publicUrl).origin;
  return async (c, next) => {
    if (c.req.header("origin") !== origin) return c.text("Forbidden", 403);
    await next();
  };
}

/** Headers for the pages this server renders: no caching, no framing, only its own nonce'd code. */
export function pageSecurity(c: Context, nonce: string, opts: { google: boolean }) {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'${opts.google ? " https://accounts.google.com/gsi/style" : ""}`,
      `script-src 'nonce-${nonce}'${opts.google ? ` ${googleScript}` : ""}`,
      `connect-src 'self'${opts.google ? " https://accounts.google.com" : ""}`,
      opts.google ? "frame-src https://accounts.google.com" : "",
      "img-src 'self' data:",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ]
      .filter(Boolean)
      .join("; "),
  );
}
