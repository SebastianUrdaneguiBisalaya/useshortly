import { keepPreviousData } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { parseAsInteger, useQueryStates } from 'nuqs';
import { useGetLinkStats } from '~/api/endpoints/analytics/analytics';
import { useListLinks } from '~/api/endpoints/links/links';
import type { GetLinkStatsParams } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Select } from '~/components/ui/forms-inputs/select/select';
import { Page } from '~/components/ui/layout/page/page';
import { ApplicationState } from '~/components/ui/overlays-feedback/application-state/application-state';
import { useTranslate } from '~/hooks/use-translate';
import { OrganizationGate } from '../share/organization-gate';
import { resolveStatsQuery, StatsGrid, StatsToolbar, statsParams, statsParsers, statsQueryOptions } from '../share/stats/stats-panels';

export default function DashboardPage() {
	return <OrganizationGate>{organization => <DashboardContent orgID={organization.id} />}</OrganizationGate>;
}

function DashboardContent({ orgID }: { orgID: number }) {
	const t = useTranslate();
	// Link, period and filters live in the URL, so a view can be shared and survives a reload.
	const [query, setQuery] = useQueryStates({ ...statsParsers, link: parseAsInteger }, statsQueryOptions);
	const links = useListLinks(orgID, { limit: 100 });
	const rows = links.data?.data ?? [];
	const linkID = query.link !== null && rows.some(link => link.id === query.link) ? query.link : (rows[0]?.id ?? null);

	const { days, hasFilters, range } = resolveStatsQuery(query);

	const params: GetLinkStatsParams = statsParams(range, query);
	const stats = useGetLinkStats(orgID, linkID ?? 0, params, { query: { enabled: linkID !== null, placeholderData: keepPreviousData } });
	// The filter menus must keep offering every value while one is applied, so they read the unfiltered numbers.
	const unfiltered = useGetLinkStats(orgID, linkID ?? 0, range, { query: { enabled: linkID !== null && hasFilters, placeholderData: keepPreviousData } });
	const optionsSource = (hasFilters ? unfiltered.data : stats.data)?.data;

	if (links.isLoading) return <ApplicationState.LoadingState className='h-full' />;
	if (rows.length === 0 || linkID === null) {
		return <ApplicationState.EmptyState className='h-full' description={t('protected.dashboard.empty.description')} icon={Link2} title={t('protected.dashboard.empty.title')} />;
	}

	const data = stats.data?.data;

	return (
		<Page.Root className='h-full py-3 sm:py-3' size='full'>
			<Page.Header>
				<div>
					<Page.Title>{t('protected.dashboard.title')}</Page.Title>
					<Page.Description>{t('protected.dashboard.description')}</Page.Description>
				</div>
				<Page.Actions>
					<div className='w-full sm:w-72'>
						{/* Another link has other countries and referrers, so the filters start over with it. */}
						<Select.Root<string> onChange={value => void setQuery({ country: null, device: null, link: Number(value), referrer: null })} value={String(linkID)}>
							<Select.Trigger aria-label={t('protected.dashboard.link.label')}>
								<Select.Value placeholder={t('protected.dashboard.link.placeholder')} />
							</Select.Trigger>
							<Select.Content>
								<Select.Search placeholder={t('protected.dashboard.link.search')} />
								<Select.ItemList>
									{rows.map(link => (
										<Select.Item key={link.id} label={link.short_url?.replace(/^https?:\/\//, '') ?? `/${link.code}`} value={String(link.id)}>
											{link.short_url?.replace(/^https?:\/\//, '') ?? `/${link.code}`}
										</Select.Item>
									))}
								</Select.ItemList>
							</Select.Content>
						</Select.Root>
					</div>
				</Page.Actions>
			</Page.Header>

			<Page.Body className='gap-4'>
				<StatsToolbar hasFilters={hasFilters} optionsSource={optionsSource} query={query} range={range} setQuery={setQuery} />

				{stats.isError ? (
					<ApplicationState.ErrorState
						actions={
							<Button onClick={() => void stats.refetch()} variant='secondary'>
								<Button.Text>{t('protected.table.refresh')}</Button.Text>
							</Button>
						}
						description={t('protected.dashboard.error.description')}
						title={t('protected.dashboard.error.title')}
					/>
				) : (
					<StatsGrid
						data={data}
						days={days}
						isLoading={stats.isPending}
						isPlaceholderData={stats.isPlaceholderData}
						onSelectCountry={country => void setQuery({ country })}
						selectedCountry={query.country}
					/>
				)}
			</Page.Body>
		</Page.Root>
	);
}
