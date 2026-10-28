import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useListLinks } from '~/api/endpoints/links/links';
import type { Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Pagination } from '~/components/ui/data-display/pagination/pagination';
import { Skeleton } from '~/components/ui/foundations/skeleton/skeleton';
import { Page } from '~/components/ui/layout/page/page';
import { useTranslate } from '~/hooks/use-translate';
import { CreateLinkDialog } from '../links/create-link-dialog';
import { OrganizationGate } from '../share/organization-gate';
import { QrCard } from './qr-card';
import { QrStyleDialog } from './qr-style-dialog';

const PAGE_SIZE = 15;
// Two columns on a phone, up to six on a wide screen: the codes are the content, so they stay small enough to scan a page at once.
const GRID = 'grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5';

export default function QrCodePage() {
	return <OrganizationGate>{organization => <QrCodeContent orgID={organization.id} />}</OrganizationGate>;
}

function QrCodeContent({ orgID }: { orgID: number }) {
	const t = useTranslate();
	const [page, setPage] = useState(1);
	const [creating, setCreating] = useState(false);
	const [styling, setStyling] = useState<Link>();
	const links = useListLinks(orgID, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
	const rows = links.data?.data ?? [];
	const total = links.data?.meta?.total ?? 0;
	// The dialog edits the freshest copy of the link, so a saved style is what the next open starts from.
	const styled = styling && (rows.find(link => link.id === styling.id) ?? styling);

	return (
		<Page.Root className='h-full' size='full'>
			<Page.Header>
				<div>
					<Page.Title>{t('protected.qr.title')}</Page.Title>
					<Page.Description>{t('protected.qr.description')}</Page.Description>
				</div>
				<Page.Actions>
					<Button onClick={() => setCreating(true)}>
						<Button.Icon icon={Plus} />
						<Button.Text>{t('protected.qr.create')}</Button.Text>
					</Button>
				</Page.Actions>
			</Page.Header>
			<Page.Body className='flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto'>
				{links.isLoading ? (
					<Skeleton className={GRID} label={t('protected.qr.loading')}>
						{Array.from({ length: 10 }, (_, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
							<div className='flex flex-col gap-3' key={index}>
								<Skeleton.Item className='aspect-square w-full rounded-2xl' />
								<Skeleton.Item className='h-4 w-2/3' />
							</div>
						))}
					</Skeleton>
				) : rows.length === 0 ? (
					<div className='flex flex-col items-center gap-4 py-20 text-center'>
						<p className='max-w-sm font-primary text-sm text-muted-foreground'>{t('protected.qr.empty')}</p>
						<Button onClick={() => setCreating(true)} variant='secondary'>
							<Button.Icon icon={Plus} />
							<Button.Text>{t('protected.qr.create')}</Button.Text>
						</Button>
					</div>
				) : (
					<ul className={GRID}>
						{rows.map(link => (
							<li className='min-w-0' key={link.id}>
								<QrCard link={link} onCustomize={setStyling} />
							</li>
						))}
					</ul>
				)}
				{total > PAGE_SIZE && <Pagination onPageChange={setPage} page={page} pageCount={Math.ceil(total / PAGE_SIZE)} pageSize={PAGE_SIZE} total={total} />}
			</Page.Body>
			<CreateLinkDialog onOpenChange={setCreating} open={creating} orgID={orgID} />
			{styled && <QrStyleDialog link={styled} onOpenChange={open => !open && setStyling(undefined)} orgID={orgID} />}
		</Page.Root>
	);
}
