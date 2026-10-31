import { keepPreviousData } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { parseAsInteger, useQueryStates } from 'nuqs';
import { useMemo, useState } from 'react';
import { useGetLinkStats } from '~/api/endpoints/analytics/analytics';
import { useGetLink, useListLinks } from '~/api/endpoints/links/links';
import type { GetLinkStatsParams, Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Select } from '~/components/ui/forms-inputs/select/select';
import { Page } from '~/components/ui/layout/page/page';
import { ApplicationState } from '~/components/ui/overlays-feedback/application-state/application-state';
import { useDebouncedValue } from '~/hooks/use-debounced-value';
import { useTranslate } from '~/hooks/use-translate';
import { OrganizationGate } from '../share/organization-gate';
import { resolveStatsQuery, StatsGrid, StatsToolbar, statsParams, statsParsers, statsQueryOptions } from '../share/stats/stats-panels';
import { useInfiniteLinks } from './use-infinite-links';

const linkLabel = (link: Link) => link.short_url?.replace(/^https?:\/\//, '') ?? `/${link.code}`;

export default function DashboardPage() {
	return <OrganizationGate>{organization => <DashboardContent orgID={organization.id} />}</OrganizationGate>;
}

function DashboardContent({ orgID }: { orgID: number }) {
	const t = useTranslate();
	// Link, period and filters live in the URL, so a view can be shared and survives a reload.
	const [query, setQuery] = useQueryStates({ ...statsParsers, link: parseAsInteger }, statsQueryOptions);
	const [search, setSearch] = useState('');
	const debouncedSearch = useDebouncedValue(search);
	// The newest link is the one shown until another is picked; it also tells an organization with no links apart.
	const newest = useListLinks(orgID, { limit: 1 });
	// The menu lists the links page by page, narrowed by the search once the typing pauses.
	const menu = useInfiniteLinks(orgID, debouncedSearch);
	const linkID = query.link ?? newest.data?.data?.[0]?.id ?? null;
	// The picked link may not be in the pages loaded (or in the search results), so its label is read apart.
	const selected = useGetLink(orgID, linkID ?? 0, { query: { enabled: linkID !== null } }).data?.data;
	const labelMap = useMemo(() => (selected?.id !== undefined ? { [String(selected.id)]: linkLabel(selected) } : undefined), [selected]);

	const { days, hasFilters, range, requestRange } = resolveStatsQuery(query);

	const params: GetLinkStatsParams = statsParams(requestRange, query);
	const stats = useGetLinkStats(orgID, linkID ?? 0, params, { query: { enabled: linkID !== null, placeholderData: keepPreviousData } });
	// The filter menus must keep offering every value while one is applied, so they read the unfiltered numbers.
	const unfiltered = useGetLinkStats(orgID, linkID ?? 0, requestRange, { query: { enabled: linkID !== null && hasFilters, placeholderData: keepPreviousData } });
	const optionsSource = (hasFilters ? unfiltered.data : stats.data)?.data;

	if (newest.isLoading) return <ApplicationState.LoadingState className='h-full' />;
	if (linkID === null) {
		return <ApplicationState.EmptyState className='h-full' description={t('protected.dashboard.empty.description')} icon={Link2} title={t('protected.dashboard.empty.title')} />;
	}

	const data = stats.data?.data;

	return (
		<Page.Root className='min-h-full py-3 sm:py-3' size='full'>
			<Page.Header>
				<div>
					<Page.Title>{t('protected.dashboard.title')}</Page.Title>
					<Page.Description>{t('protected.dashboard.description')}</Page.Description>
				</div>
				<Page.Actions>
					<div className='w-full sm:w-72'>
						{/* Another link has other countries and referrers, so the filters start over with it. */}
						<Select.Root<string>
							filterItems={false}
							labelMap={labelMap}
							onChange={value => void setQuery({ country: null, device: null, link: Number(value), referrer: null })}
							onQueryChange={setSearch}
							value={String(linkID)}
						>
							<Select.Trigger aria-label={t('protected.dashboard.link.label')}>
								<Select.Value placeholder={t('protected.dashboard.link.placeholder')} />
							</Select.Trigger>
							<Select.Content>
								<Select.Search placeholder={t('protected.dashboard.link.search')} />
								<Select.ItemList onReachEnd={() => menu.hasNextPage && !menu.isFetchingNextPage && void menu.fetchNextPage()}>
									{menu.links.map(link => (
										<Select.Item key={link.id} label={linkLabel(link)} value={String(link.id)}>
											{linkLabel(link)}
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
