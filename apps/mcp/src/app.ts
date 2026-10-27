import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ApiClient } from "./api/client.js";
import type { IdentityProvider } from "./api/identity.js";
import type { Auth } from "./auth/auth.js";
import { basePath, resourcePath } from "./auth/options.js";
import type { Config } from "./config.js";
import { consentRoutes } from "./http/consent.js";
import { signInRoutes } from "./http/sign-in.js";
import { mcpRoute } from "./mcp/route.js";

// Endpoints MCP clients call from any origin, with no cookies: discovery, keys and the token endpoint.
const publicPaths = [/^\/\.well-known\//, new RegExp(`^${resourcePath}$`), new RegExp(`^${basePath}/jwks$`), new RegExp(`^${basePath}/oauth2/token$`)];

// No allowHeaders list: the browser's own Access-Control-Request-Headers are echoed, so the MCP
// protocol's extra headers work without this file knowing them. No cookies are ever involved.
const openCors = cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
  exposeHeaders: ["WWW-Authenticate", "MCP-Protocol-Version"],
  maxAge: 600,
});

export function createApp(deps: { config: Config; auth: Auth; identity: IdentityProvider; api: ApiClient }) {
  const { auth } = deps;
  const app = new Hono();

  app.use("*", (c, next) => (publicPaths.some((p) => p.test(c.req.path)) ? openCors(c, next) : next()));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/", signInRoutes(deps));
  app.route("/", consentRoutes(deps));

  // The MCP endpoint takes POST only: GET and DELETE are the sessions of the 2025 protocol.
  const mcp = mcpRoute(deps);
  app.post(resourcePath, (c) => mcp(c.req.raw));
  app.all(resourcePath, (c) => c.text("Method not allowed", 405, { Allow: "POST" }));

  // Better Auth answers its own endpoints and the OAuth discovery documents.
  const betterAuth = (c: { req: { raw: Request } }) => auth.handler(c.req.raw);
  app.on(["GET", "HEAD", "POST", "OPTIONS"], "/.well-known/*", betterAuth);
  app.on(["GET", "HEAD", "POST", "OPTIONS"], `${basePath}/*`, betterAuth);

  return app;
}
