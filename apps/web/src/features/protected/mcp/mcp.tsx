import { BlockCode } from '~/components/ui/code-content/block-code/block-code';
import { Snippet } from '~/components/ui/code-content/snippet/snippet';
import { Badge } from '~/components/ui/data-display/badge/badge';
import { Typography } from '~/components/ui/foundations/typography/typography';
import { Page } from '~/components/ui/layout/page/page';
import { DocsToc } from '~/components/ui/navigation/docs-toc/docs-toc';
import { Code, DocTable, H2, Prose } from '../share/doc-parts';
import { OrganizationGate } from '../share/organization-gate';
import { MCP_PROMPTS, MCP_TOOLS } from './mcp-tools';

/** The MCP server runs next to the API on its own host: set `VITE_MCP_URL` to its public `/mcp` address. */
const mcpUrl = () => import.meta.env.VITE_MCP_URL || 'https://<your-mcp-host>/mcp';

const SECTIONS = [
	{ id: 'overview', title: 'Overview' },
	{ id: 'install', title: 'Install' },
	{ id: 'authorize', title: 'Authorize' },
	{ id: 'tools', title: 'Tools' },
	{ id: 'prompts', title: 'Prompts' },
	{ id: 'examples', title: 'Examples' },
	{ id: 'security', title: 'Security' },
	{ id: 'limits', title: 'Limits' },
];

export default function McpPage() {
	return <OrganizationGate>{() => <McpContent />}</OrganizationGate>;
}

function McpContent() {
	const url = mcpUrl();

	return (
		<Page.Root className='h-full' size='md'>
			<DocsToc aria-label='On this page'>
				{SECTIONS.map(section => (
					<DocsToc.Item id={section.id} key={section.id} title={section.title} />
				))}
			</DocsToc>
			<Page.Header>
				<div>
					<Page.Title>MCP server</Page.Title>
					<Page.Description>Let an AI assistant work with your links.</Page.Description>
				</div>
			</Page.Header>
			<Page.Body className='gap-12'>
				<Page.Section className='scroll-mt-8 border-t-0 pt-0' id='overview'>
					<H2>Overview</H2>
					<Prose>
						<Typography.P>
							The Model Context Protocol (MCP) lets an assistant such as Claude Code, Claude or Cursor call tools on a server. useshortly’s MCP server gives them the tools to list your
							organizations and links, create and delete links, read click statistics, fetch QR codes and manage custom domains, in plain conversation.
						</Typography.P>
						<Typography.P>
							You sign in once in your browser, the way you sign in to any app that asks for access. There is no API key to paste: the assistant only gets what you allow on the consent
							screen.
						</Typography.P>
					</Prose>
					<BlockCode.Root code={url} language='bash'>
						<BlockCode.Header>
							<span>Server URL</span>
							<BlockCode.CopyButton />
						</BlockCode.Header>
						<BlockCode.Content />
					</BlockCode.Root>
				</Page.Section>

				<Page.Section className='scroll-mt-8' id='install'>
					<H2>Install</H2>
					<Prose>
						<Typography.P>Add the server URL to your assistant. The commands below are for the assistants most people use; each one’s own documentation has the latest steps.</Typography.P>
					</Prose>
					<Typography.H3 className='text-xl'>Claude Code</Typography.H3>
					<BlockCode.Root
						code={`claude mcp add --transport http useshortly ${url}

# then, inside Claude Code:
/mcp   # choose "useshortly" and Authenticate`}
						language='bash'
					>
						<BlockCode.Header>
							<span>Terminal</span>
							<BlockCode.CopyButton />
						</BlockCode.Header>
						<BlockCode.Content />
					</BlockCode.Root>
					<Typography.H3 className='text-xl'>Claude and other apps with custom connectors</Typography.H3>
					<Prose>
						<Typography.P>
							Open the connectors settings, add a remote MCP server and paste <Code>{url}</Code> as its URL. No other field is needed.
						</Typography.P>
					</Prose>
					<Typography.H3 className='text-xl'>Cursor and clients with an mcp.json file</Typography.H3>
					<BlockCode.Root
						code={`{
  "mcpServers": {
    "useshortly": {
      "url": "${url}"
    }
  }
}`}
						language='json'
					>
						<BlockCode.Header>
							<span>mcp.json</span>
							<BlockCode.CopyButton />
						</BlockCode.Header>
						<BlockCode.Content />
					</BlockCode.Root>
					<Typography.H3 className='text-xl'>Try it without an assistant</Typography.H3>
					<Prose>
						<Typography.P>
							The MCP Inspector is a small web app to call the tools by hand. Pick <Code>Streamable HTTP</Code> as the transport and paste the server URL.
						</Typography.P>
					</Prose>
					<Snippet.Root
						commands={{
							bun: 'bunx @modelcontextprotocol/inspector',
							npm: 'npx @modelcontextprotocol/inspector',
							pnpm: 'pnpm dlx @modelcontextprotocol/inspector',
							yarn: 'yarn dlx @modelcontextprotocol/inspector',
						}}
					>
						<Snippet.Header>
							<Snippet.Tabs />
							<Snippet.CopyButton />
						</Snippet.Header>
						<Snippet.Content />
					</Snippet.Root>
				</Page.Section>

				<Page.Section className='scroll-mt-8' id='authorize'>
					<H2>Authorize</H2>
					<Prose>
						<Typography.P>The first time you connect an assistant, it opens your browser. This happens once per assistant.</Typography.P>
						<Typography.List className='my-0'>
							<li>Sign in with the email and password (or Google account) you use for useshortly.</li>
							<li>
								Read what the assistant asks for. <Code>mcp:read</Code> lets it look; <Code>mcp:write</Code> also lets it create and delete. Untick write to keep it read-only.
							</li>
							<li>Click Allow. The assistant is connected.</li>
						</Typography.List>
						<Typography.P>
							A read-only connection never even sees the tools that change things. Access lasts 15 minutes and renews by itself for 14 days, after which you authorize again.
						</Typography.P>
					</Prose>
				</Page.Section>

				<Page.Section className='scroll-mt-8 gap-8' id='tools'>
					<div className='flex flex-col gap-3'>
						<H2>Tools</H2>
						<Prose>
							<Typography.P>
								The assistant picks the tool; you just ask. Tools marked <Code>write</Code> exist only on connections where you granted write access. Start with{' '}
								<Code>list_organizations</Code>: every other tool takes an organization id.
							</Typography.P>
						</Prose>
					</div>
					{MCP_TOOLS.map(tool => (
						<article className='flex flex-col gap-4 border-t border-border pt-8 first:border-t-0 first:pt-0' id={`tool-${tool.name}`} key={tool.name}>
							<div className='flex flex-col gap-2'>
								<div className='flex flex-wrap items-center gap-2'>
									<Typography.H3 className='text-xl'>
										<Code>{tool.name}</Code>
									</Typography.H3>
									<Badge variant={tool.write ? 'warning' : 'default'}>
										<Badge.Text>{tool.write ? 'write' : 'read'}</Badge.Text>
									</Badge>
								</div>
								<Typography.P className='max-w-prose text-muted-foreground'>{tool.description}</Typography.P>
							</div>
							<BlockCode.Root
								code={`${tool.name}(${tool.input.length === 0 ? '' : `{ ${tool.input.map(row => `${row.name}${row.required ? '' : '?'}: ${row.type}`).join(', ')} }`})\n// returns: ${tool.returns}`}
								language='typescript'
							>
								<BlockCode.Header>
									<span>Signature</span>
									<BlockCode.CopyButton />
								</BlockCode.Header>
								<BlockCode.Content />
							</BlockCode.Root>
							{tool.input.length > 0 && <DocTable caption={`${tool.name}: input`} nameLabel='Input' rows={tool.input} />}
						</article>
					))}
				</Page.Section>

				<Page.Section className='scroll-mt-8' id='prompts'>
					<H2>Prompts</H2>
					<Prose>
						<Typography.P>Prompts are ready-made requests an assistant can offer you, usually as slash commands. They tell it which tools to call and what to answer.</Typography.P>
					</Prose>
					{MCP_PROMPTS.map(prompt => (
						<div className='flex flex-col gap-3' key={prompt.name}>
							<div className='flex flex-wrap items-center gap-2'>
								<Typography.H3 className='text-xl'>
									<Code>{prompt.name}</Code>
								</Typography.H3>
								<Badge variant={prompt.write ? 'warning' : 'default'}>
									<Badge.Text>{prompt.write ? 'write' : 'read'}</Badge.Text>
								</Badge>
							</div>
							<Typography.P className='max-w-prose text-muted-foreground'>{prompt.description}</Typography.P>
							<DocTable caption={`${prompt.name}: arguments`} nameLabel='Argument' rows={prompt.input} />
						</div>
					))}
				</Page.Section>

				<Page.Section className='scroll-mt-8' id='examples'>
					<H2>Examples</H2>
					<Prose>
						<Typography.P>Ask in your own words. These are requests that work, and the tools the assistant calls to answer them.</Typography.P>
					</Prose>
					<BlockCode.Root
						code={`"Shorten https://example.com/blog/summer-sale as summer1"
// list_organizations → create_link

"How did summer1 do last month? Which countries clicked most?"
// list_links → get_link_stats

"Give me the QR code for summer1 as a 512 px image"
// get_link_qr

"Add go.example.com as a domain and tell me which DNS record to create"
// add_domain

"I created the record. Check go.example.com"
// list_domains → verify_domain

"Delete the link summer1"
// delete_link (your assistant asks first)`}
						language='typescript'
					>
						<BlockCode.Header>
							<span>Things you can say</span>
							<BlockCode.CopyButton />
						</BlockCode.Header>
						<BlockCode.Content />
					</BlockCode.Root>
				</Page.Section>

				<Page.Section className='scroll-mt-8' id='security'>
					<H2>Security</H2>
					<Prose>
						<Typography.List className='my-0'>
							<li>Your password is typed on the sign-in page and checked by the API. The MCP server never stores it.</li>
							<li>The assistant’s token only works with the MCP server. For each call the server signs a new 60-second token for you and the scope you granted.</li>
							<li>Deleting your useshortly account cuts every assistant’s access at once.</li>
							<li>The server cannot create or delete organizations or accounts, manage members, invitations or API keys, edit unlock pages or delete domains, whatever you grant.</li>
						</Typography.List>
					</Prose>
				</Page.Section>

				<Page.Section className='scroll-mt-8' id='limits'>
					<H2>Limits</H2>
					<Prose>
						<Typography.List className='my-0'>
							<li>
								The server speaks MCP protocol <Code>2026-07-28</Code>. An assistant that only supports the 2025 versions cannot connect.
							</li>
							<li>Assistants that need dynamic client registration cannot connect; clients identify themselves with a metadata document instead.</li>
							<li>Many people signing in at the same moment can reach the sign-in rate limit; they see “too many attempts” and can try again shortly.</li>
						</Typography.List>
					</Prose>
				</Page.Section>
			</Page.Body>
		</Page.Root>
	);
}
