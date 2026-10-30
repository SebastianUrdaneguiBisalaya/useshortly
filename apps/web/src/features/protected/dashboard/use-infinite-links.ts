import { type InfiniteData, keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { getListLinksQueryKey, listLinks } from '~/api/endpoints/links/links';
import type { Link, LinkListResponse } from '~/api/model';

const PAGE_SIZE = 30;

/**
 * The organization's links one page at a time, optionally narrowed by a search the server runs over the code and the
 * destination. The pages stay on screen while a new search loads.
 *
 * Its key starts with the list's, so creating or deleting a link refreshes it too.
 */
export function useInfiniteLinks(orgID: number, search: string) {
	const query = useInfiniteQuery<LinkListResponse, Error, InfiniteData<LinkListResponse, number>, readonly unknown[], number>({
		getNextPageParam: (last, pages) => {
			const loaded = pages.reduce((count, page) => count + (page.data?.length ?? 0), 0);
			return loaded < (last.meta?.total ?? 0) && (last.data?.length ?? 0) > 0 ? loaded : undefined;
		},
		initialPageParam: 0,
		placeholderData: keepPreviousData,
		queryFn: ({ pageParam, signal }) => listLinks(orgID, { limit: PAGE_SIZE, offset: pageParam, ...(search ? { q: search } : {}) }, undefined, signal),
		queryKey: [...getListLinksQueryKey(orgID), 'infinite', search],
	});

	const links: Link[] = query.data?.pages.flatMap(page => page.data ?? []) ?? [];
	return { fetchNextPage: query.fetchNextPage, hasNextPage: query.hasNextPage, isFetchingNextPage: query.isFetchingNextPage, isPlaceholderData: query.isPlaceholderData, links };
}
