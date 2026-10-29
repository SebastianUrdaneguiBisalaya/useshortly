import { type InfiniteData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getListCampaignsQueryKey, listCampaigns } from '~/api/endpoints/campaigns/campaigns';
import type { Campaign, CampaignListResponse } from '~/api/model';

/** The most the API lists at once. */
const PAGE_SIZE = 100;

/**
 * Every campaign of the organization, for the pickers and filters that offer them all. It reads the pages one after the
 * other until there are no more, so an organization with more than 100 campaigns still gets them all. `isLoading` stays
 * on until the last page is in.
 *
 * Its key starts with the list's, so creating, editing or deleting a campaign refreshes it too.
 */
export function useAllCampaigns(orgID: number, { enabled = true }: { enabled?: boolean } = {}) {
	const query = useInfiniteQuery<CampaignListResponse, Error, InfiniteData<CampaignListResponse, number>, readonly unknown[], number>({
		enabled,
		getNextPageParam: (last, pages) => {
			const loaded = pages.reduce((count, page) => count + (page.data?.length ?? 0), 0);
			return loaded < (last.meta?.total ?? 0) && (last.data?.length ?? 0) > 0 ? loaded : undefined;
		},
		initialPageParam: 0,
		queryFn: ({ pageParam, signal }) => listCampaigns(orgID, { limit: PAGE_SIZE, offset: pageParam }, undefined, signal),
		queryKey: [...getListCampaignsQueryKey(orgID), 'all'],
	});
	const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

	useEffect(() => {
		if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	const campaigns: Campaign[] = query.data?.pages.flatMap(page => page.data ?? []) ?? [];
	return { campaigns, isLoading: query.isPending || hasNextPage };
}
