import { useState } from 'react';
import { toast } from 'sonner';
import { exportCampaign } from '~/api/endpoints/campaigns/campaigns';
import type { ExportCampaignParams } from '~/api/model';
import { useTranslate } from '~/hooks/use-translate';

/**
 * Downloads the CSV of a campaign: a row per link with the clicks it got between `from` and `to` (every click without
 * them). The request needs the `Authorization` header, so a plain link would not work: the file is read as a Blob and
 * saved through an object URL, and the outcome is reported with a toast.
 */
export function useDownloadCampaignCsv(orgID: number, campaignID: number) {
	const t = useTranslate();
	const [isPending, setPending] = useState(false);

	const download = async (range?: ExportCampaignParams) => {
		setPending(true);
		try {
			const csv = (await exportCampaign(orgID, campaignID, range)) as Blob;
			const link = document.createElement('a');
			link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
			// The same name the API suggests in Content-Disposition.
			link.download = `campaign-${campaignID}.csv`;
			link.click();
			URL.revokeObjectURL(link.href);
			toast.success(t('protected.toast.campaignExported'));
		} catch {
			// A failed answer is a Blob too, so its error code cannot be read; the message is generic.
			toast.error(t('protected.toast.campaignExportFailed'));
		} finally {
			setPending(false);
		}
	};

	return { download, isPending };
}
