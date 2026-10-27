import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Auth } from "./auth/auth.js";
import { basePath } from "./auth/options.js";

// Endpoints MCP clients call from any origin, with no cookies: discovery, keys and the token endpoint.
const publicPaths = [/^\/\.well-known\//, new RegExp(`^${basePath}/jwks$`), new RegExp(`^${basePath}/oauth2/token$`)];

const openCors = cors({
  origin: "*",
  allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "DPoP", "MCP-Protocol-Version"],
  maxAge: 600,
});

export function createApp({ auth }: { auth: Auth }) {
  const app = new Hono();

  app.use("*", (c, next) => (publicPaths.some((p) => p.test(c.req.path)) ? openCors(c, next) : next()));

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Better Auth answers its own endpoints and the OAuth discovery documents.
  const betterAuth = (c: { req: { raw: Request } }) => auth.handler(c.req.raw);
  app.on(["GET", "HEAD", "POST", "OPTIONS"], "/.well-known/*", betterAuth);
  app.on(["GET", "HEAD", "POST", "OPTIONS"], `${basePath}/*`, betterAuth);

  return app;
}
