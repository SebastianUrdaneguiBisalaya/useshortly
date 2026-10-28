import { Link } from 'react-router';
import { BlockCode } from '~/components/ui/code-content/block-code/block-code';
import { Typography } from '~/components/ui/foundations/typography/typography';
import { Page } from '~/components/ui/layout/page/page';
import { DocsToc } from '~/components/ui/navigation/docs-toc/docs-toc';
import { useOrganizationTo } from '../organization/use-current-organization';
import { Code, DocTable, H2, Prose } from '../share/doc-parts';
import { OrganizationGate } from '../share/organization-gate';
import { ENDPOINT_GROUPS } from './api-endpoints';
import { API_TYPES } from './api-types';
import { EndpointDoc } from './endpoint-doc';

/** Where the API answers: the configured backend, or this origin (Vite proxies `/api` in development). */
const apiBase = () => `${import.meta.env.VITE_API_URL || (typeof window === 'undefined' ? 'https://your-host' : window.location.origin)}/api/v1`;

const SECTIONS = [
	{ id: 'overview', title: 'Overview' },
	{ id: 'authentication', title: 'Authentication' },
	{ id: 'conventions', title: 'Requests and responses' },
	{ id: 'errors', title: 'Errors' },
	{ id: 'types', title: 'Types' },
	...ENDPOINT_GROUPS.map(group => ({ id: group.id, title: group.title })),
];

export default function DocsPage() {
	return <OrganizationGate>{organization => <DocsContent orgID={organization.id} />}</OrganizationGate>;
}

function DocsContent({ orgID }: { orgID: number }) {
	const toOrganization = useOrganizationTo();
	const base = apiBase();

	return (
		<Page.Root className='h-full' size='md'>
			<DocsToc aria-label='On this page'>
				{SECTIONS.map(section => (
					<DocsToc.Item id={section.id} key={section.id} title={section.title} />
				))}
			</DocsToc>
			<Page.Header>
				<div>
					<Page.Title>API reference</Page.Title>
					<Page.Description>Everything an API key can do, one endpoint at a time.</Page.Description>
				</div>
			</Page.Header>
			<Page.Body className='gap-12'>
				<Page.Section className='scroll-mt-8 border-t-0 pt-0' id='overview'>
					<H2>Overview</H2>
					<Prose>
						<Typography.P>
							The useshortly API is a JSON API over HTTPS. Create short links, read their click statistics, fetch and style their QR codes, protect them with a password and serve them
							from your own domain.
						</Typography.P>
						<Typography.P>
							Every endpoint lives under one base URL and acts on one organization. Your organization’s id is <Code>{orgID}</Code>.
						</Typography.P>
					</Prose>
					<BlockCode.Root
						code={`BASE_URL=${base}
ORG_ID=${orgID}
USHORTLY_API_KEY=usl_…   # created in the next section`}
						language='bash'
					>
						<BlockCode.Header>
							<span>Variables used by every example</span>
							<BlockCode.CopyButton />
						</BlockCode.Header>
						<BlockCode.Content />
					</BlockCode.Root>
				</Page.Section>

				<Page.Section className='scroll-mt-8' id='authentication'>
					<H2>Authentication</H2>
					<Prose>
						<Typography.P>
							Requests are authenticated with an API key, sent as a bearer token. Keys belong to one organization and never get more permissions than the scope they were created with.
						</Typography.P>
					</Prose>
					<Typography.H3 className='text-xl'>Get an API key</Typography.H3>
					<Prose>
						<Typography.List className='my-0'>
							<li>
								Open{' '}
								<Link className='underline underline-offset-4' to={toOrganization('/api-keys')}>
									API keys
								</Link>{' '}
								in the dashboard and choose the organization.
							</li>
							<li>Create a key: give it a name, pick a scope and, if you want it to stop working on a date, an expiration.</li>
							<li>
								Copy the secret, which starts with <Code>usl_</Code>. It is shown once and cannot be read again; if you lose it, delete the key and create another.
							</li>
						</Typography.List>
					</Prose>
					<Typography.H3 className='text-xl'>Scopes</Typography.H3>
					<DocTable
						caption='API key scopes'
						nameLabel='Scope'
						rows={[
							{ description: 'Safe requests only: every GET endpoint, including the QR image.', name: 'read', type: 'GET' },
							{ description: 'Everything read can do, plus creating, changing and deleting.', name: 'write', type: 'GET POST PUT DELETE' },
						]}
						typeLabel='Methods'
					/>
					<Prose>
						<Typography.Muted>
							The scope is fixed when the key is created. To change it, create a new key. Managing organizations, members and API keys themselves needs a signed-in user, not a key.
						</Typography.Muted>
					</Prose>
					<Typography.H3 className='text-xl'>Send the key</Typography.H3>
					<BlockCode.Root
						code={`curl "$BASE_URL/orgs/$ORG_ID/links" \\
  -H "Authorization: Bearer $USHORTLY_API_KEY"`}
						language='bash'
					>
						<BlockCode.Header>
							<span>curl</span>
							<BlockCode.CopyButton />
						</BlockCode.Header>
						<BlockCode.Content />
					</BlockCode.Root>
				</Page.Section>

				<Page.Section className='scroll-mt-8' id='conventions'>
					<H2>Requests and responses</H2>
					<Prose>
						<Typography.P>
							Bodies are JSON: send <Code>Content-Type: application/json</Code>. Dates are RFC 3339 in UTC, except statistics days, which are <Code>YYYY-MM-DD</Code> in UTC. Ids are
							numbers.
						</Typography.P>
						<Typography.P>
							A successful response wraps its payload in <Code>data</Code>. Lists add <Code>meta</Code> and are paged with <Code>limit</Code> and <Code>offset</Code>, newest first.
						</Typography.P>
					</Prose>
					<BlockCode.Root
						code={`{
  "data": [{ "id": 42, "code": "summer1" }],
  "meta": { "limit": 20, "offset": 0, "total": 1 }
}`}
						language='json'
					>
						<BlockCode.Header>
							<span>A page of results</span>
							<BlockCode.CopyButton />
						</BlockCode.Header>
						<BlockCode.Content />
					</BlockCode.Root>
					<Prose>
						<Typography.P>
							The API limits how many requests a key can make. Over the limit it answers <Code>429</Code> with <Code>rate_limited</Code>; wait the seconds in the <Code>Retry-After</Code>{' '}
							header before trying again. <Code>X-RateLimit-Limit</Code> tells you the budget.
						</Typography.P>
					</Prose>
				</Page.Section>

				<Page.Section className='scroll-mt-8' id='errors'>
					<H2>Errors</H2>
					<Prose>
						<Typography.P>
							Failed requests answer with a 4xx or 5xx status and the same body shape. Branch on <Code>code</Code>, which is stable; <Code>message</Code> is for people.{' '}
							<Code>details</Code> points at the fields that were invalid.
						</Typography.P>
					</Prose>
					<BlockCode.Root
						code={`{
  "error": {
    "code": "invalid_url",
    "message": "the url must be http(s) and at most 255 characters"
  }
}`}
						language='json'
					>
						<BlockCode.Header>
							<span>An error</span>
							<BlockCode.CopyButton />
						</BlockCode.Header>
						<BlockCode.Content />
					</BlockCode.Root>
					<Typography.H3 className='text-xl'>Errors every endpoint can return</Typography.H3>
					<DocTable
						caption='Errors every endpoint can return'
						nameLabel='Status'
						rows={[
							{ description: 'The key is missing, wrong or expired.', name: '401', type: 'unauthorized · api_key_expired' },
							{ description: 'The key’s scope is read and the endpoint needs write.', name: '403', type: 'insufficient_scope' },
							{ description: 'The organization is not the key’s. Resources of another organization look like they do not exist.', name: '404', type: 'not_found' },
							{ description: 'Too many requests. See Retry-After.', name: '429', type: 'rate_limited' },
							{ description: 'The server failed. Safe to retry reads; check a write before repeating it.', name: '500', type: 'internal_error' },
						]}
						typeLabel='Code'
					/>
				</Page.Section>

				<Page.Section className='scroll-mt-8' id='types'>
					<H2>Types</H2>
					<Prose>
						<Typography.P>The shapes used by the endpoints below, as TypeScript. Copy them into your client.</Typography.P>
					</Prose>
					<BlockCode.Root code={API_TYPES} language='typescript'>
						<BlockCode.Header>
							<span>types.ts</span>
							<BlockCode.CopyButton />
						</BlockCode.Header>
						<BlockCode.Content />
					</BlockCode.Root>
				</Page.Section>

				{ENDPOINT_GROUPS.map(group => (
					<Page.Section className='scroll-mt-8 gap-8' id={group.id} key={group.id}>
						<div className='flex flex-col gap-3'>
							<H2>{group.title}</H2>
							<Prose>
								<Typography.P>{group.description}</Typography.P>
							</Prose>
						</div>
						{group.endpoints.map(endpoint => (
							<EndpointDoc endpoint={endpoint} key={endpoint.id} />
						))}
					</Page.Section>
				))}
			</Page.Body>
		</Page.Root>
	);
}
