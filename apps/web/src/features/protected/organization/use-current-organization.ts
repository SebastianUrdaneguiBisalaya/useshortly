import { parseAsInteger, useQueryState } from 'nuqs';
import type { To } from 'react-router';
import { useListMyOrganizations } from '~/api/endpoints/orgs/orgs';

/** The selected organization lives in the URL (`?org=3`), so it can be shared, bookmarked and survives a reload. */
export function useOrganizationParam() {
	return useQueryState('org', parseAsInteger);
}

/**
 * The user's organizations and the one selected. `?org=` wins while the user still belongs to it;
 * otherwise (no param, or an id that is not theirs) it falls back to the first organization, without
 * touching the URL. `organization` is `undefined` while loading or when the user has none yet.
 * `/orgs` returns every organization of the user, so there is nothing to paginate.
 */
export function useCurrentOrganization() {
	const query = useListMyOrganizations();
	const [organizationId, select] = useOrganizationParam();
	const organizations = query.data?.data ?? [];
	const organization = organizations.find(item => item.id === organizationId) ?? organizations[0];

	return {
		isPending: query.isPending,
		organization,
		organizations,
		select,
	};
}

/** Builds in-app links that keep the selected `?org=`, so moving between pages does not drop the organization. */
export function useOrganizationTo() {
	const [organizationId] = useOrganizationParam();
	return (pathname: string): To => ({
		pathname,
		search: organizationId === null ? '' : `?org=${organizationId}`,
	});
}
