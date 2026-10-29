import type { ReactNode } from 'react';
import { Badge } from '~/components/ui/data-display/badge/badge';
import { Typography } from '~/components/ui/foundations/typography/typography';
import { cn } from '~/components/ui/utils/tailwind/cn';

/** A column of reading width: documentation lines stay under ~75 characters. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn('flex max-w-prose flex-col gap-3', className)}>{children}</div>;
}

export function H2({ id, children }: { id?: string; children: ReactNode }) {
	return (
		<Typography.H2 className='border-b-0 pb-0 text-2xl' id={id}>
			{children}
		</Typography.H2>
	);
}

export function Code({ children }: { children: ReactNode }) {
	return <Typography.InlineCode>{children}</Typography.InlineCode>;
}

export interface DocRow {
	description: ReactNode;
	name: string;
	required?: boolean;
	type: string;
}

/** Parameters, fields or tools as a table: name and type in monospace, the meaning in prose. */
export function DocTable({ rows, nameLabel = 'Name', typeLabel = 'Type', caption }: { rows: DocRow[]; nameLabel?: string; typeLabel?: string; caption: string }) {
	return (
		<div className='overflow-x-auto rounded-xl border border-border'>
			<table className='w-full min-w-xl border-collapse text-left font-primary text-sm'>
				<caption className='sr-only'>{caption}</caption>
				<thead>
					<tr className='border-b border-border bg-muted/50 text-muted-foreground'>
						<th className='px-4 py-2 font-medium' scope='col'>
							{nameLabel}
						</th>
						<th className='px-4 py-2 font-medium' scope='col'>
							{typeLabel}
						</th>
						<th className='px-4 py-2 font-medium' scope='col'>
							Description
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(row => (
						<tr className='border-b border-border align-top last:border-b-0' key={`${row.name}:${row.type}`}>
							<td className='px-4 py-2.5 font-secondary font-semibold whitespace-nowrap text-foreground'>
								{row.name}
								{row.required && <span className='ml-1 text-destructive'>*</span>}
							</td>
							<td className='px-4 py-2.5 font-secondary whitespace-nowrap text-muted-foreground'>{row.type}</td>
							<td className='px-4 py-2.5 text-foreground'>{row.description}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

const METHOD_VARIANT = { DELETE: 'destructive', GET: 'default', POST: 'success', PUT: 'warning' } as const;

export function MethodBadge({ method }: { method: keyof typeof METHOD_VARIANT }) {
	return (
		<Badge variant={METHOD_VARIANT[method]}>
			<Badge.Text>{method}</Badge.Text>
		</Badge>
	);
}
