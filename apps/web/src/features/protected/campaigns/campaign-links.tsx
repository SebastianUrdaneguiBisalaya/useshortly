import type { ColumnDef } from '@tanstack/react-table';
import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useListLinks } from '~/api/endpoints/links/links';
import type { CampaignChannel, Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Badge } from '~/components/ui/data-display/badge/badge';
import { DataTable, type DataTableFeatures } from '~/components/ui/data-display/data-table/data-table';
import { Page } from '~/components/ui/layout/page/page';
import { useLanguage } from '~/hooks/use-language';
import { useTranslate } from '~/hooks/use-translate';
import { formatDateTime } from '~/lib/date-time';
import { useOrganizationParam } from '../organization/use-current-organization';

const PAGE_SIZE = 25;

/** The links shared in the channels of a campaign, each with the channel it was put in. */
export function CampaignLinks({ orgID, campaignID, channels }: { orgID: number; campaignID: number; channels: CampaignChannel[] }) {
	const t = useTranslate();
	const { locale } = useLanguage();
	const navigate = useNavigate();
	const [organizationID] = useOrganizationParam();
	const [page, setPage] = useState(1);
	// The links page reads the campaign from `?campaign=`; the organization's own `?org=` stays.
	const openFilteredLinks = () => {
		const params = new URLSearchParams(organizationID === null ? {} : { org: String(organizationID) });
		params.set('campaign', String(campaignID));
		void navigate({ pathname: '/links', search: `?${params}` });
	};
	const links = useListLinks(orgID, { campaign_id: campaignID, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
	const total = links.data?.meta?.total ?? 0;

	const columns = useMemo<ColumnDef<DataTableFeatures, Link>[]>(() => {
		const channelNames = new Map(channels.map(channel => [channel.id, channel.name]));
		return [
			{
				// The destination sits under the short link it belongs to, as in the links page.
				cell: ({ row }) => (
					<div className='flex min-w-0 flex-col'>
						<span className='truncate font-medium text-foreground'>{row.original.short_url?.replace(/^https?:\/\//, '')}</span>
						<span className='truncate text-muted-foreground text-xs' title={row.original.origin_url}>
							{row.original.origin_url}
						</span>
					</div>
				),
				header: t('protected.campaigns.detail.links.columns.link'),
				id: 'link',
				size: 420,
			},
			{
				cell: ({ row }) => (
					<Badge variant='outline'>
						<Badge.Text>{channelNames.get(row.original.channel_id) ?? '—'}</Badge.Text>
					</Badge>
				),
				header: t('protected.campaigns.detail.links.columns.channel'),
				id: 'channel',
				size: 180,
			},
			{
				cell: ({ row }) => formatDateTime(row.original.created_at, locale),
				header: t('protected.campaigns.detail.links.columns.createdAt'),
				id: 'createdAt',
				size: 180,
			},
		];
	}, [t, locale, channels]);

	return (
		<Page.Section>
			<Page.SectionHeader>
				<div>
					<Page.Title level='section'>{t('protected.campaigns.detail.links.title')}</Page.Title>
					<Page.Description>{t('protected.campaigns.detail.links.description')}</Page.Description>
				</div>
				<Page.Actions>
					<Button onClick={openFilteredLinks} variant='secondary'>
						<Button.Icon icon={ExternalLink} />
						<Button.Text>{t('protected.campaigns.detail.links.viewAll')}</Button.Text>
					</Button>
				</Page.Actions>
			</Page.SectionHeader>
			<DataTable
				columns={columns}
				data={links.data?.data ?? []}
				emptyMessage={t('protected.campaigns.detail.links.empty')}
				isLoading={links.isLoading}
				pagination={{
					onPageChange: setPage,
					page,
					pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
					pageSize: PAGE_SIZE,
					total,
				}}
			/>
		</Page.Section>
	);
}
