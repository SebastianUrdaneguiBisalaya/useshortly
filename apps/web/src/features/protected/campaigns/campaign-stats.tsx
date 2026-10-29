import { keepPreviousData } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import { useState } from 'react';
import { useGetCampaignStats } from '~/api/endpoints/analytics/analytics';
import type { GetCampaignStatsParams } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { CHART_COLORS } from '~/components/ui/data-display/charts/charts';
import { Page } from '~/components/ui/layout/page/page';
import { ApplicationState } from '~/components/ui/overlays-feedback/application-state/application-state';
import { Popover } from '~/components/ui/overlays-feedback/popover/popover';
import { useLanguage } from '~/hooks/use-language';
import { useTranslate } from '~/hooks/use-translate';
import { Panel, Ranking, resolveStatsQuery, StatsGrid, StatsToolbar, statsParams, statsParsers, statsQueryOptions } from '../share/stats/stats-panels';
import { useDownloadCampaignCsv } from './download-campaign-csv';

/** How many channels the comparison lists; they come most clicks first, so these are the best performing ones. */
const CHANNELS_SHOWN = 10;

/** Clicks on every link of a campaign, with the comparison of its channels first: which one brings the most. */
export function CampaignStats({ orgID, campaignID }: { orgID: number; campaignID: number }) {
	const t = useTranslate();
	const { locale } = useLanguage();
	const exporter = useDownloadCampaignCsv(orgID, campaignID);
	const [exportOpen, setExportOpen] = useState(false);
	// Period and filters live in the URL, as in the dashboard, so a view can be shared and survives a reload.
	const [query, setQuery] = useQueryStates(statsParsers, statsQueryOptions);
	const { days, hasFilters, range } = resolveStatsQuery(query);

	const params: GetCampaignStatsParams = statsParams(range, query);
	const stats = useGetCampaignStats(orgID, campaignID, params, { query: { placeholderData: keepPreviousData } });
	// The filter menus must keep offering every value while one is applied, so they read the unfiltered numbers.
	const unfiltered = useGetCampaignStats(orgID, campaignID, range, { query: { enabled: hasFilters, placeholderData: keepPreviousData } });
	const optionsSource = (hasFilters ? unfiltered.data : stats.data)?.data;
	const data = stats.data?.data;
	const channels = data?.channels ?? [];

	return (
		<Page.Section className='border-t-0 pt-0'>
			<Page.SectionHeader>
				<div>
					<Page.Title level='section'>{t('protected.campaigns.detail.stats.title')}</Page.Title>
					<Page.Description>{t('protected.campaigns.detail.stats.description')}</Page.Description>
				</div>
				<Page.Actions>
					<Popover onOpenChange={setExportOpen} open={exportOpen}>
						<Popover.Trigger>
							<Button loading={exporter.isPending} variant='secondary'>
								<Button.Icon icon={Download} />
								<Button.Text>{t('protected.campaigns.detail.export.action')}</Button.Text>
							</Button>
						</Popover.Trigger>
						<Popover.Content align='end' className='flex w-56 flex-col gap-1 p-1'>
							<Button
								className='justify-start'
								onClick={() => {
									setExportOpen(false);
									void exporter.download(range);
								}}
								variant='ghost'
							>
								<Button.Text>{t('protected.campaigns.detail.export.period')}</Button.Text>
							</Button>
							<Button
								className='justify-start'
								onClick={() => {
									setExportOpen(false);
									void exporter.download();
								}}
								variant='ghost'
							>
								<Button.Text>{t('protected.campaigns.detail.export.allTime')}</Button.Text>
							</Button>
						</Popover.Content>
					</Popover>
				</Page.Actions>
			</Page.SectionHeader>
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
				>
					<Panel className='col-span-12' title={t('protected.campaigns.detail.stats.channels.title')}>
						{channels.length === 0 ? (
							<p className='text-muted-foreground text-sm'>{t('protected.campaigns.detail.stats.channels.empty')}</p>
						) : (
							<>
								<Ranking
									color={CHART_COLORS.blue}
									items={channels.slice(0, CHANNELS_SHOWN).map(channel => ({ clicks: channel.clicks ?? 0, name: channel.name ?? '' }))}
									locale={locale}
									seriesName={t('protected.dashboard.charts.daily.series')}
								/>
								{channels.length > CHANNELS_SHOWN && (
									<p className='mt-3 text-muted-foreground text-xs'>{t('protected.campaigns.detail.stats.channels.more', { count: channels.length - CHANNELS_SHOWN })}</p>
								)}
							</>
						)}
					</Panel>
				</StatsGrid>
			)}
		</Page.Section>
	);
}
