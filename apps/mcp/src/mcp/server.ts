import { McpServer } from "@modelcontextprotocol/server";
import type { UserApi } from "../api/client.js";
import { registerWhoami } from "./tools/whoami.js";

const instructions = `useshortly is a URL shortener. These tools act on the signed-in user's account.
Links belong to organizations: look up the organization id first, then pass it to the other tools.
Read-only connections cannot create or delete anything.`;

/** One server per request, bound to the user the request's access token belongs to. */
export function createMcpServer(api: UserApi): McpServer {
  const server = new McpServer({ name: "useshortly", version: "1.0.0" }, { instructions });
  const context = { api };
  registerWhoami(server, context);
  return server;
}
