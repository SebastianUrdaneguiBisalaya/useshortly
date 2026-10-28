import { useId } from 'react';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';

/** Account settings. Empty for now: the sections go in `Modal.Body`. */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();

	return (
		<Modal.Root onOpenChange={onOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId}>
				<Modal.Header>
					<Modal.Title id={titleId}>{t('protected.nav.settings')}</Modal.Title>
				</Modal.Header>
				<Modal.Body />
			</Modal.Content>
		</Modal.Root>
	);
}
