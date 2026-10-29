import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Megaphone, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { getListCampaignsQueryKey, useDeleteCampaign, useGetCampaign, useListCampaignChannels } from '~/api/endpoints/campaigns/campaigns';
import { getListLinksQueryKey } from '~/api/endpoints/links/links';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Page } from '~/components/ui/layout/page/page';
import { ApplicationState } from '~/components/ui/overlays-feedback/application-state/application-state';
import { ConfirmDialog } from '~/components/ui/overlays-feedback/confirm-dialog/confirm-dialog';
import { useTranslate } from '~/hooks/use-translate';
import { useOrganizationTo } from '../organization/use-current-organization';
import { OrganizationGate } from '../share/organization-gate';
import { CampaignChannels } from './campaign-channels';
import { CampaignDialog } from './campaign-dialog';
import { CampaignLinks } from './campaign-links';
import { CampaignStats } from './campaign-stats';

/** Channels are capped at 100 per campaign, so one request lists them all. */
const ALL_CHANNELS = { limit: 100 };

export default function CampaignDetailPage() {
	return <OrganizationGate>{organization => <CampaignDetailContent orgID={organization.id} />}</OrganizationGate>;
}

function CampaignDetailContent({ orgID }: { orgID: number }) {
	const t = useTranslate();
	const navigate = useNavigate();
	const toOrganization = useOrganizationTo();
	const queryClient = useQueryClient();
	const campaignID = Number(useParams().campaignID);
	const valid = Number.isInteger(campaignID) && campaignID > 0;
	const [editing, setEditing] = useState(false);
	const deleteCampaign = useDeleteCampaign();
	const campaign = useGetCampaign(orgID, campaignID, { query: { enabled: valid, retry: false } });
	const channels = useListCampaignChannels(orgID, campaignID, ALL_CHANNELS, { query: { enabled: valid } });

	if (!valid || campaign.isError) {
		return (
			<ApplicationState.EmptyState
				actions={
					<Button onClick={() => void navigate(toOrganization('/campaigns'))}>
						<Button.Icon icon={ArrowLeft} />
						<Button.Text>{t('protected.campaigns.detail.back')}</Button.Text>
					</Button>
				}
				className='h-full'
				description={t('protected.campaigns.detail.notFound.description')}
				icon={Megaphone}
				title={t('protected.campaigns.detail.notFound.title')}
			/>
		);
	}
	if (campaign.isPending) return <ApplicationState.LoadingState className='h-full' title={t('protected.campaigns.detail.loading')} />;

	const data = campaign.data?.data;

	return (
		<Page.Root className='h-full py-3 sm:py-3' size='full'>
			<Page.Header>
				<div>
					<Link className='mb-2 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground' to={toOrganization('/campaigns')}>
						<ArrowLeft aria-hidden className='size-4' />
						{t('protected.campaigns.detail.back')}
					</Link>
					<Page.Title>{data?.name}</Page.Title>
					{data?.description && <Page.Description>{data.description}</Page.Description>}
				</div>
				<Page.Actions>
					<Button onClick={() => setEditing(true)} variant='secondary'>
						<Button.Icon icon={Pencil} />
						<Button.Text>{t('protected.campaigns.edit.label')}</Button.Text>
					</Button>
					<ConfirmDialog.Root
						lang={{ cancel: t('protected.confirm.cancel'), confirm: t('protected.confirm.delete') }}
						onConfirm={async () => {
							await deleteCampaign.mutateAsync({ campaignID, orgID });
							toast.success(t('protected.toast.campaignDeleted'));
							await Promise.all([
								queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(orgID) }),
								// Its links leave the campaign.
								queryClient.invalidateQueries({ queryKey: getListLinksQueryKey(orgID) }),
							]);
							void navigate(toOrganization('/campaigns'));
						}}
						variant='destructive'
					>
						<ConfirmDialog.Trigger>
							<Button variant='secondary'>
								<Button.Icon icon={Trash2} />
								<Button.Text>{t('protected.campaigns.delete.label')}</Button.Text>
							</Button>
						</ConfirmDialog.Trigger>
						<ConfirmDialog.Content>
							<ConfirmDialog.Icon />
							<ConfirmDialog.Title>{t('protected.campaigns.delete.title', { name: data?.name ?? '' })}</ConfirmDialog.Title>
							<ConfirmDialog.Description>{t('protected.campaigns.delete.description')}</ConfirmDialog.Description>
							<ConfirmDialog.Footer>
								<ConfirmDialog.Cancel />
								<ConfirmDialog.Confirm />
							</ConfirmDialog.Footer>
						</ConfirmDialog.Content>
					</ConfirmDialog.Root>
				</Page.Actions>
			</Page.Header>
			<Page.Body className='min-h-0 flex-1 gap-8'>
				<CampaignStats campaignID={campaignID} orgID={orgID} />
				<CampaignChannels campaignID={campaignID} channels={channels.data?.data ?? []} isLoading={channels.isLoading} orgID={orgID} />
				<CampaignLinks campaignID={campaignID} channels={channels.data?.data ?? []} orgID={orgID} />
			</Page.Body>
			<CampaignDialog campaign={data} key={data?.updated_at} onOpenChange={setEditing} open={editing} orgID={orgID} />
		</Page.Root>
	);
}
