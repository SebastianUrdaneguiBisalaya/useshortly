import { BlockCode } from '~/components/ui/code-content/block-code/block-code';
import { Badge } from '~/components/ui/data-display/badge/badge';
import { Typography } from '~/components/ui/foundations/typography/typography';
import { Code, DocTable, MethodBadge } from '../share/doc-parts';
import type { Endpoint } from './api-endpoints';

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 201: 'Created', 204: 'No Content' };

/** Path parameters are the same for every endpoint of a kind, so they are derived from the path itself. */
function pathParams(path: string) {
	const rows = [{ description: 'The organization the API key belongs to.', name: 'orgID', required: true, type: 'number' }];
	if (path.includes('{linkID}')) rows.push({ description: 'The link’s id, from the create or list responses.', name: 'linkID', required: true, type: 'number' });
	if (path.includes('{domainID}')) rows.push({ description: 'The domain’s id, from the create or list responses.', name: 'domainID', required: true, type: 'number' });
	return rows;
}

function curl(endpoint: Endpoint, accept?: string) {
	const url = `$BASE_URL/orgs/$ORG_ID${endpoint.path.replace('{linkID}', '$LINK_ID').replace('{domainID}', '$DOMAIN_ID')}${endpoint.queryExample ? `?${endpoint.queryExample}` : ''}`;
	const lines = [`curl -X ${endpoint.method} "${url}" \\`, '  -H "Authorization: Bearer $USHORTLY_API_KEY"'];
	if (endpoint.bodyExample) {
		lines[1] += ' \\';
		lines.push('  -H "Content-Type: application/json" \\');
		lines.push(`  -d '${endpoint.bodyExample.replace(/\n\s*/g, ' ')}'`);
	}
	if (accept) {
		lines[lines.length - 1] += ' \\';
		lines.push(`  -o ${accept}`);
	}
	return lines.join('\n');
}

function ScopeBadge({ scope }: { scope: 'read' | 'write' }) {
	return (
		<Badge variant={scope === 'write' ? 'warning' : 'default'}>
			<Badge.Text>{scope} scope</Badge.Text>
		</Badge>
	);
}

/**
 * One endpoint documented the way a library documents a function: what it does, its signature, then
 * a reference of what it takes, how to call it, what it returns and how it can fail.
 */
export function EndpointDoc({ endpoint }: { endpoint: Endpoint }) {
	const params = pathParams(endpoint.path);
	const returns = endpoint.status === 204 ? `// ${endpoint.status} ${STATUS_TEXT[204]}, empty body` : `// ${endpoint.status} ${STATUS_TEXT[endpoint.status] ?? ''}\n${endpoint.returns}`;
	const isImage = endpoint.id === 'get-qr';

	return (
		<article className='flex flex-col gap-4 border-t border-border pt-8 first:border-t-0 first:pt-0' id={endpoint.id}>
			<div className='flex flex-col gap-2'>
				<Typography.H3 className='text-xl'>{endpoint.title}</Typography.H3>
				<div className='flex flex-wrap items-center gap-2'>
					<MethodBadge method={endpoint.method} />
					<Code>
						/api/v1/orgs/{'{orgID}'}
						{endpoint.path}
					</Code>
					<ScopeBadge scope={endpoint.scope} />
				</div>
				<Typography.P className='max-w-prose text-muted-foreground'>{endpoint.description}</Typography.P>
			</div>

			<Typography.H4 className='text-base'>Parameters</Typography.H4>
			<DocTable
				caption={`${endpoint.title}: parameters`}
				nameLabel='Parameter'
				rows={[
					...params.map(row => ({ ...row, description: `In the path. ${row.description}` })),
					...(endpoint.query ?? []).map(field => ({ ...field, description: `In the query string. ${field.description}` })),
					...(endpoint.body ?? []).map(field => ({ ...field, description: `In the JSON body. ${field.description}` })),
				]}
			/>

			<Typography.H4 className='text-base'>Request</Typography.H4>
			<BlockCode.Root code={curl(endpoint, isImage ? 'qr.png' : undefined)} language='bash'>
				<BlockCode.Header>
					<span>curl</span>
					<BlockCode.CopyButton />
				</BlockCode.Header>
				<BlockCode.Content />
			</BlockCode.Root>

			<Typography.H4 className='text-base'>Returns</Typography.H4>
			<BlockCode.Root code={returns} language='typescript'>
				<BlockCode.Header>
					<span>TypeScript</span>
					<BlockCode.CopyButton />
				</BlockCode.Header>
				<BlockCode.Content />
			</BlockCode.Root>
			{endpoint.responseExample && (
				<BlockCode.Root code={endpoint.responseExample} language='json'>
					<BlockCode.Header>
						<span>{`Example ${endpoint.status} response`}</span>
						<BlockCode.CopyButton />
					</BlockCode.Header>
					<BlockCode.Content />
				</BlockCode.Root>
			)}

			{endpoint.errors.length > 0 && (
				<>
					<Typography.H4 className='text-base'>Errors</Typography.H4>
					<DocTable
						caption={`${endpoint.title}: errors`}
						nameLabel='Status'
						rows={endpoint.errors.map(error => ({ description: error.meaning, name: String(error.status), type: error.code }))}
						typeLabel='Code'
					/>
				</>
			)}
		</article>
	);
}
