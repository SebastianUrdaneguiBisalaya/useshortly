import { Hono } from "hono";
import { cors } from "hono/cors";
import type { IdentityProvider } from "./api/identity.js";
import type { Auth } from "./auth/auth.js";
import { basePath } from "./auth/options.js";
import type { Config } from "./config.js";
import { consentRoutes } from "./http/consent.js";
import { signInRoutes } from "./http/sign-in.js";

// Endpoints MCP clients call from any origin, with no cookies: discovery, keys and the token endpoint.
const publicPaths = [/^\/\.well-known\//, new RegExp(`^${basePath}/jwks$`), new RegExp(`^${basePath}/oauth2/token$`)];

const openCors = cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "DPoP", "MCP-Protocol-Version"],
  maxAge: 600,
});

export function createApp(deps: { config: Config; auth: Auth; identity: IdentityProvider }) {
  const { auth } = deps;
  const app = new Hono();

  app.use("*", (c, next) => (publicPaths.some((p) => p.test(c.req.path)) ? openCors(c, next) : next()));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/", signInRoutes(deps));
  app.route("/", consentRoutes(deps));

  // Better Auth answers its own endpoints and the OAuth discovery documents.
  const betterAuth = (c: { req: { raw: Request } }) => auth.handler(c.req.raw);
  app.on(["GET", "HEAD", "POST", "OPTIONS"], "/.well-known/*", betterAuth);
  app.on(["GET", "HEAD", "POST", "OPTIONS"], `${basePath}/*`, betterAuth);

  return app;
}
