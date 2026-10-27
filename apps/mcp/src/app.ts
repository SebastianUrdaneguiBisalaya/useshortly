// import { Hono } from "hono";
// import { cors } from "hono/cors";
// import { HTTPException } from "hono/http-exception";
// import { failure, success } from "./lib/response.js";
// import { requireAuth } from "./middleware/auth.js";
// import type { RpcContext } from "./router.js";
// import { router } from "./router.js";

// const trustedOrigins = (process.env.AUTH_TRUSTED_ORIGINS ?? "")
//   .split(",")
//   .map((origin) => origin.trim())
//   .filter(Boolean);

// const app = new Hono();

// app.use(
//   "*",
//   cors({
//     credentials: true,
//     origin: trustedOrigins,
//   }),
// );

// app.onError((err, c) => {
//   const locale = resolveLocale(c.req.header("accept-language") ?? null);

//   if (err instanceof HTTPException) {
//     return c.json(
//       failure(err.constructor.name, err.message, err.status),
//       err.status,
//     );
//   }

//   console.error(err);
//   return c.json(
//     failure("INTERNAL_SERVER_ERROR", t(locale, "error.internal"), 500),
//     500,
//   );
// });

// app.notFound((c) => {
//   const locale = resolveLocale(c.req.header("accept-language") ?? null);
//   return c.json(failure("NOT_FOUND", t(locale, "error.notFound"), 404), 404);
// });

// app.on(
//   [
//     "GET",
//     "POST",
//   ],
//   "/api/auth/**",
//   (c) => auth.handler(c.req.raw),
// );

// app.get("/", (c) =>
//   c.json(
//     success({
//       status: "ok",
//     }),
//   ),
// );

// app.get("/me", requireAuth, (c) => c.json(success(c.get("user"))));

// // Type-safe RPC layer (packages/contracts + apps/web/app/lib/rpc.ts). This has
// // its own response envelope (oRPC's), separate from the REST routes above.
// const rpc = new RPCHandler(router);

// app.use("/rpc/*", async (c, next) => {
//   const session = await auth.api.getSession({
//     headers: c.req.raw.headers,
//   });
//   const context: RpcContext = {
//     user: session?.user ?? null,
//   };

//   const { matched, response } = await rpc.handle(c.req.raw, {
//     context,
//     prefix: "/rpc",
//   });

//   if (matched) return c.newResponse(response.body, response);
//   await next();
// });

// export { app };