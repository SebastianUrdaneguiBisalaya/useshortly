import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { segment } from "../../api/client.js";
import { domain } from "../../api/schemas.js";
import { guard, ok, type ToolContext } from "./helpers.js";
import { oneLine } from "./text.js";

type Domain = z.output<typeof domain>;

const organizationId = z.number().int().positive().describe("Organization id, from list_organizations.");
const domainId = z.number().int().positive().describe("Domain id, from list_domains.");

// A host name such as go.example.com: lower or upper case letters, digits and hyphens in dot
// separated labels. No scheme, port, path or wildcard.
const host = z
  .string()
  .max(253)
  .regex(
    /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/,
    "must be a domain name such as go.example.com, without scheme, port or path",
  );

const structured = (d: Domain) => ({
  id: d.id,
  host: d.host,
  verified: d.verified,
  verified_at: d.verified_at,
  created_at: d.created_at,
  dns_record: d.verification ?? null,
});

const record = (d: Domain) =>
  d.verification ? `Create this DNS record: type ${d.verification.type}, name ${d.verification.name}, value ${d.verification.value}.` : null;

const describe = (d: Domain) =>
  `- id ${d.id}: ${oneLine(d.host, 100)} — ${d.verified ? "verified" : "not verified"}${d.verification ? `. ${record(d)}` : ""}`;

export function registerListDomains(server: McpServer, { api }: ToolContext) {
  server.registerTool(
    "list_domains",
    {
      title: "List custom domains",
      description:
        "Lists the custom domains of an organization with their ids and whether each is verified. A link can use a verified domain through create_link's domain_id. For a domain that is not verified yet, the DNS record to create is included.",
      inputSchema: z.object({ organization_id: organizationId }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ organization_id }) =>
      guard(async () => {
        const { data } = await api.get(`/orgs/${segment(organization_id)}/domains`, z.array(domain));
        const text = data.length ? data.map(describe).join("\n") : "This organization has no custom domains.";
        return ok(text, { domains: data.map(structured) });
      }),
  );
}

export function registerAddDomain(server: McpServer, { api }: ToolContext) {
  server.registerTool(
    "add_domain",
    {
      title: "Add a custom domain",
      description:
        "Registers a custom domain (a host such as go.example.com) for an organization and returns the DNS TXT record the user must create at their DNS provider to prove they own it. The domain cannot be used until it is verified: after the user created the record, call verify_domain.",
      inputSchema: z.object({ organization_id: organizationId, host }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ organization_id, host }) =>
      guard(async () => {
        const { data } = await api.post(`/orgs/${segment(organization_id)}/domains`, domain, { body: { host } });
        const next = data.verification
          ? `${record(data)} DNS changes can take a while; then call verify_domain with domain id ${data.id}.`
          : "It is already verified.";
        return ok(`Added ${oneLine(data.host, 100)} (domain id ${data.id}). ${next}`, { domain: structured(data) });
      }),
  );
}

export function registerVerifyDomain(server: McpServer, { api }: ToolContext) {
  server.registerTool(
    "verify_domain",
    {
      title: "Verify a custom domain",
      description:
        "Checks that the DNS TXT record from add_domain exists and, if so, marks the domain as verified. If the record is not visible yet it fails: DNS changes can take a while, so wait and try again rather than adding the domain again.",
      inputSchema: z.object({ organization_id: organizationId, domain_id: domainId }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ organization_id, domain_id }) =>
      guard(async () => {
        const { data } = await api.post(`/orgs/${segment(organization_id)}/domains/${segment(domain_id)}/verify`, domain);
        return ok(
          data.verified
            ? `${oneLine(data.host, 100)} is verified and can be used for links (domain id ${data.id}).`
            : `${oneLine(data.host, 100)} is not verified yet. ${record(data) ?? ""}`.trim(),
          { domain: structured(data) },
        );
      }),
  );
}
