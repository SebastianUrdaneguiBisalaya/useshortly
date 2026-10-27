import type { BetterAuthOptions } from "better-auth";
import { jwt } from "better-auth/plugins";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource as fetchOverTheNetwork } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import type { Config } from "../config.js";
import type { AuthDatabase } from "../db/index.js";
import { delegatedSession } from "./delegated-session.js";
import { supportedScopes } from "./scopes.js";

/** Path Better Auth is mounted on; its issuer is the public URL plus this. */
export const basePath = "/api/auth";

/** Pages the OAuth flow sends the user to. Served by this app (see http/). */
export const loginPage = "/sign-in";
export const consentPage = "/consent";

/** The MCP endpoint: also the resource identifier access tokens are bound to. */
export const resourcePath = "/mcp";

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
  jwks: "mcp_jwks",
  oauthClient: "mcp_oauth_client",
  oauthRefreshToken: "mcp_oauth_refresh_token",
  oauthAccessToken: "mcp_oauth_access_token",
  oauthConsent: "mcp_oauth_consent",
  oauthClientAssertion: "mcp_oauth_client_assertion",
  oauthClientResource: "mcp_oauth_client_resource",
  oauthResource: "mcp_oauth_resource",
} as const;

/** Where client metadata documents are fetched from. Only tests replace it. */
export type Network = { fetchClientMetadataResource: typeof fetchOverTheNetwork };

export function authOptions(
  config: Config,
  database: AuthDatabase["database"],
  network: Network = { fetchClientMetadataResource: fetchOverTheNetwork },
) {
  const resource = `${config.publicUrl}${resourcePath}`;
  return {
    appName: "useshortly",
    baseURL: `${config.publicUrl}${basePath}`,
    basePath,
    secret: config.authSecret,
    trustedOrigins: config.trustedOrigins,
    database,
    // Better Auth rate limits its own endpoints per client address. It can only read the address from
    // headers, so behind a trusted reverse proxy (TRUST_PROXY) it takes the one the proxy set; with
    // no proxy there is no header to trust and everyone shares one bucket per endpoint.
    advanced: { ipAddress: { ipAddressHeaders: config.trustProxy ? ["x-forwarded-for"] : [] } },
    // The jwt plugin's /token would turn any session into a JWT; only the OAuth token endpoint may issue.
    disabledPaths: ["/token"],
    user: {
      modelName: tableNames.user,
      additionalFields: {
        // The user's id in the API. Logical reference: it lives in another database file.
        apiUserId: { type: "number", required: true, unique: true, input: false, fieldName: "user_id" },
      },
    },
    // The session only carries the user through authorization; the tokens it yields outlive it.
    session: { modelName: tableNames.session, expiresIn: 8 * 60 * 60 },
    account: { modelName: tableNames.account },
    verification: { modelName: tableNames.verification },
    plugins: [
      delegatedSession(),
      jwt({
        jwks: { keyPairConfig: { alg: "EdDSA" } },
        schema: { jwks: { modelName: tableNames.jwks } },
      }),
      mcp({
        loginPage,
        consentPage,
        resource,
        scopes: supportedScopes,
        // Short-lived access tokens; the refresh token renews them without another consent.
        accessTokenExpiresIn: 15 * 60,
        refreshTokenExpiresIn: 14 * 24 * 60 * 60,
        // The API identifies the user by its own id, not by Better Auth's.
        customAccessTokenClaims: ({ user }) => {
          const apiUserId = user?.apiUserId;
          return typeof apiUserId === "number" ? { api_user_id: apiUserId } : {};
        },
        schema: {
          oauthClient: { modelName: tableNames.oauthClient },
          oauthRefreshToken: { modelName: tableNames.oauthRefreshToken },
          oauthAccessToken: { modelName: tableNames.oauthAccessToken },
          oauthConsent: { modelName: tableNames.oauthConsent },
          oauthClientAssertion: { modelName: tableNames.oauthClientAssertion },
          oauthClientResource: { modelName: tableNames.oauthClientResource },
          oauthResource: { modelName: tableNames.oauthResource },
        },
      }),
      // Clients identify themselves with a metadata document (the MCP-recommended way); no DCR.
      cimd({ fetchClientMetadataResource: network.fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    ],
  } satisfies BetterAuthOptions;
}
