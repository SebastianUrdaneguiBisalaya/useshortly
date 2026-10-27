import { serve } from "@hono/node-server";
import { createIdentityClient } from "./api/identity.js";
import { createApp } from "./app.js";
import { createAuth } from "./auth/auth.js";
import { migrate } from "./auth/migrate.js";
import { authOptions } from "./auth/options.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";

const config = loadConfig();
const db = await openDatabase(config.database);
const options = authOptions(config, db.database);

// Pending Better Auth migrations run before Better Auth is built and before any request is accepted.
const { created, added } = await migrate(options);
if (created.length || added.length) {
  console.log(`migrations applied: created [${created.join(", ")}], altered [${added.join(", ")}]`);
}

const auth = createAuth(options);
const server = serve({ fetch: createApp({ config, auth, identity: createIdentityClient({ apiUrl: config.apiUrl }) }).fetch, port: config.port }, (info) => {
  console.log(`useshortly MCP (${config.environment}) listening on :${info.port}, public URL ${config.publicUrl}`);
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, shutting down`);
  server.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
