import { McpServer } from "@modelcontextprotocol/server";
import type { UserApi } from "../api/client.js";
import { registerLinkQr, registerLinkStats } from "./tools/analytics.js";
import { registerListLinks } from "./tools/links.js";
import { registerListOrganizations } from "./tools/organizations.js";
import { registerCreateLink, registerDeleteLink } from "./tools/write-links.js";
import { registerWhoami } from "./tools/whoami.js";

const instructions = `useshortly is a URL shortener. These tools act on the signed-in user's account.
Links belong to organizations: look up the organization id first, then pass it to the other tools.
Read-only connections cannot create or delete anything.`;

/** One server per request, bound to the user the request's access token belongs to. */
export function createMcpServer(api: UserApi): McpServer {
  const server = new McpServer({ name: "useshortly", version: "1.0.0" }, { instructions });
  const context = { api };
  registerWhoami(server, context);
  registerListOrganizations(server, context);
  registerListLinks(server, context);
  registerLinkStats(server, context);
  registerLinkQr(server, context);

  // Tools that change things exist only for connections the user granted write access: a
  // read-only connection does not even see them, and the API would refuse them anyway.
  if (api.principal.scope === "write") {
    registerCreateLink(server, context);
    registerDeleteLink(server, context);
  }
  return server;
}
