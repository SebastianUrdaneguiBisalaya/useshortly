import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import type { Context, MiddlewareHandler } from "hono";
import {
  IdentityUnavailableError,
  InvalidCredentialsError,
  RateLimitedError,
  type Identity,
  type IdentityProvider,
} from "../api/identity.js";
import type { Auth } from "../auth/auth.js";
import { basePath } from "../auth/options.js";
import type { Config } from "../config.js";
import { clientIp } from "./client-ip.js";
import { Layout } from "./layout.js";
import { googleScript, newNonce, pageSecurity, sameOrigin } from "./security.js";

type Deps = { config: Config; auth: Auth; identity: IdentityProvider };

const messages = {
  invalid: "Incorrect email or password.",
  limited: "Too many attempts. Try again in a few minutes.",
  unavailable: "useshortly could not be reached. Try again shortly.",
  google: "Google sign-in failed. Try again or use your email and password.",
  expired: "This sign-in link is missing or expired. Start again from your MCP client.",
} as const;
type Problem = keyof typeof messages;

/**
 * The OAuth flow sends the user here with the authorization request, signed by Better Auth,
 * in the query string. It is carried through the form untouched and handed back to the
 * authorize endpoint, which checks the signature: nothing here can change what is authorized.
 */
const validQuery = (q: string | undefined): q is string =>
  !!q && q.length <= 4096 && new URLSearchParams(q).has("sig") && new URLSearchParams(q).has("client_id");

const resumeUrl = (query: string) => `${basePath}/oauth2/authorize?${query}`;

export function signInRoutes({ config, auth, identity }: Deps) {
  const app = new Hono();
  const googleEnabled = config.googleClientId !== "";

  // Guessing limits on top of the API's own. Only failed credentials count (a 401): a good
  // sign-in, or the API being down, never uses up anyone's attempts. In memory, which is
  // enough for one instance; a restart only ever lets a few extra attempts through.
  const limiter = (limit: number, key: (c: Context) => string | Promise<string>, tooMany: (c: Context) => Response | Promise<Response>) =>
    rateLimiter({
      windowMs: 10 * 60_000,
      limit,
      standardHeaders: "draft-7",
      keyGenerator: key,
      skipSuccessfulRequests: true,
      requestWasSuccessful: (c) => c.res.status !== 401,
      handler: async (c) => tooMany(c) as never,
    });
  const ipKey = (c: Context) => `ip:${clientIp(c, config.trustProxy)}`;
  const formEmail = async (c: Context) => {
    const form = await c.req.parseBody();
    return typeof form.email === "string" ? form.email.trim().toLowerCase() : "";
  };
  const formQuery = async (c: Context) => {
    const form = await c.req.parseBody();
    return typeof form.oauth_query === "string" ? form.oauth_query : undefined;
  };
  const passwordLimits = [
    limiter(20, ipKey, async (c) => page(c, await formQuery(c), "limited", 429)),
    // An empty email has no account to protect: it falls back to the address.
    limiter(8, async (c) => `account:${(await formEmail(c)) || ipKey(c)}`, async (c) => page(c, await formQuery(c), "limited", 429)),
  ];
  const googleLimits = [limiter(20, ipKey, (c) => c.json({ error: messages.limited }, 429))];

  const page = (c: Context, query: string | undefined, problem?: Problem, status: 200 | 401 | 429 | 503 = 200) => {
    const nonce = newNonce();
    pageSecurity(c, nonce, { google: googleEnabled });
    c.status(status);
    return c.html(
      <Layout title="Sign in · useshortly" nonce={nonce}>
        <h1>Sign in to useshortly</h1>
        {validQuery(query) ? (
          <>
            <p>An MCP client wants to use your account.</p>
            <form method="post" action="/sign-in">
              <input type="hidden" name="oauth_query" value={query} />
              <label for="email">Email</label>
              <input id="email" name="email" type="email" autocomplete="username" required maxlength={255} />
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required maxlength={1024} />
              <button type="submit">Sign in</button>
            </form>
            {googleEnabled && (
              <>
                <hr />
                <button id="google" class="secondary" type="button" data-client-id={config.googleClientId} data-query={query}>
                  Continue with Google
                </button>
                <script src={googleScript} nonce={nonce} async defer></script>
                <script nonce={nonce} dangerouslySetInnerHTML={{ __html: googleButton }} />
              </>
            )}
          </>
        ) : (
          <p>{messages.expired}</p>
        )}
        <div id="problem" class="error" role="alert" hidden={!problem}>
          {problem ? messages[problem] : ""}
        </div>
      </Layout>,
    );
  };

  /** Starts the Better Auth session for an identity the API vouched for. */
  const startSession = async (c: Context, who: Identity, query: string) => {
    const created = await auth.api.createDelegatedSession({
      body: {
        apiUserId: who.apiUserId,
        email: who.email,
        emailVerified: who.emailVerified,
        name: who.name,
        image: who.imageUrl,
      },
      headers: c.req.raw.headers,
      asResponse: true,
    });
    const headers = new Headers({ Location: resumeUrl(query), "Cache-Control": "no-store" });
    for (const cookie of created.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
    return headers;
  };

  const problemOf = (error: unknown): { problem: Problem; status: 401 | 429 | 503 } => {
    if (error instanceof InvalidCredentialsError) return { problem: "invalid", status: 401 };
    if (error instanceof RateLimitedError) return { problem: "limited", status: 429 };
    if (error instanceof IdentityUnavailableError) return { problem: "unavailable", status: 503 };
    throw error;
  };

  app.get("/sign-in", (c) => page(c, new URL(c.req.url).search.slice(1)));

  app.post("/sign-in", sameOrigin(config.publicUrl), ...passwordLimits, async (c) => {
    const form = await c.req.parseBody();
    const query = typeof form.oauth_query === "string" ? form.oauth_query : undefined;
    const email = typeof form.email === "string" ? form.email.trim().toLowerCase() : "";
    const password = typeof form.password === "string" ? form.password : "";
    if (!validQuery(query)) return page(c, undefined);
    if (!email || email.length > 255 || !password || password.length > 1024) return page(c, query, "invalid", 401);

    const ip = clientIp(c, config.trustProxy);
    try {
      const who = await identity.password(email, password, ip);
      return new Response(null, { status: 303, headers: await startSession(c, who, query) });
    } catch (error) {
      const { problem, status } = problemOf(error);
      return page(c, query, problem, status);
    }
  });

  if (googleEnabled) {
    app.post("/sign-in/google", sameOrigin(config.publicUrl), ...googleLimits, async (c) => {
      const body = await c.req.json().catch(() => null);
      const code = typeof body?.code === "string" ? body.code : "";
      const query = typeof body?.oauth_query === "string" ? body.oauth_query : undefined;
      if (!code || code.length > 2048 || !validQuery(query)) return c.json({ error: messages.expired }, 400);

      const ip = clientIp(c, config.trustProxy);
      try {
        const who = await identity.google(code, ip);
        const headers = await startSession(c, who, query);
        headers.delete("Location");
        headers.set("Content-Type", "application/json");
        return new Response(JSON.stringify({ redirect: resumeUrl(query) }), { status: 200, headers });
      } catch (error) {
        try {
          const { problem, status } = problemOf(error);
          return c.json({ error: problem === "invalid" ? messages.google : messages[problem] }, status);
        } catch {
          throw error;
        }
      }
    });
  }

  return app;
}

// Runs under the page's nonce. Reads its inputs from data attributes: nothing is interpolated.
const googleButton = `
(function () {
  var btn = document.getElementById("google");
  var box = document.getElementById("problem");
  function fail(text) { box.textContent = text; box.hidden = false; }
  btn.addEventListener("click", function () {
    if (!window.google || !google.accounts) return fail("Google sign-in is still loading. Try again.");
    google.accounts.oauth2.initCodeClient({
      client_id: btn.dataset.clientId,
      scope: "openid email profile",
      ux_mode: "popup",
      callback: function (r) {
        if (!r.code) return fail("Google sign-in was cancelled.");
        fetch("/sign-in/google", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: r.code, oauth_query: btn.dataset.query }),
        })
          .then(function (res) { return res.json(); })
          .then(function (j) { if (j.redirect) location.assign(j.redirect); else fail(j.error || "Google sign-in failed."); })
          .catch(function () { fail("Google sign-in failed."); });
      },
    }).requestCode();
  });
})();
`;
