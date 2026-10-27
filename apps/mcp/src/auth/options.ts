import type { BetterAuthOptions } from "better-auth";
import type { Config } from "../config.js";
import type { AuthDatabase } from "../db/index.js";

/**
 * Better Auth's tables live in the MCP server's own database and all start with mcp_, so
 * nothing in them can be mistaken for the API's tables. The API's users are not copied here:
 * mcp_user only keeps a reference (user_id) to the account that signed in through the API.
 */
export const tableNames = {
  user: "mcp_user",
  session: "mcp_session",
  account: "mcp_account",
  verification: "mcp_verification",
} as const;

export function baseAuthOptions(config: Config, database: AuthDatabase["database"]) {
  return {
    appName: "useshortly",
    baseURL: config.publicUrl,
    secret: config.authSecret,
    trustedOrigins: config.trustedOrigins,
    database,
    user: {
      modelName: tableNames.user,
      additionalFields: {
        // The user's id in the API. Logical reference: it lives in another database file.
        apiUserId: { type: "number", required: true, unique: true, input: false, fieldName: "user_id" },
      },
    },
    session: { modelName: tableNames.session },
    account: { modelName: tableNames.account },
    verification: { modelName: tableNames.verification },
  } satisfies BetterAuthOptions;
}
