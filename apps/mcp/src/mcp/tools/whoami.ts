import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { guard, ok, type ToolContext } from "./helpers.js";

const me = z.object({
  id: z.number(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});

export function registerWhoami(server: McpServer, { api }: ToolContext) {
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Returns the useshortly account this connection acts for (name and email) and whether it may only read or also make changes.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      guard(async () => {
        const { data } = await api.get("/me", me);
        const name = `${data.first_name} ${data.last_name}`.trim();
        const access = api.principal.scope === "write" ? "read and write" : "read-only";
        return ok(`Signed in as ${name} <${data.email}> with ${access} access.`, {
          id: data.id,
          name,
          email: data.email,
          access: api.principal.scope,
        });
      }),
  );
}
