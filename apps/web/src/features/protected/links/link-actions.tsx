import { Download, Ellipsis, Megaphone, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Popover } from '~/components/ui/overlays-feedback/popover/popover';
import { useTranslate } from '~/hooks/use-translate';

/** The "⋯" menu of a link row: download its QR, change its campaign channel or ask to delete it. Clicks never reach the row, so the drawer doesn't open. */
export function LinkActions({ onDownloadQr, onChangeChannel, onDelete }: { onDownloadQr: () => void; onChangeChannel: () => void; onDelete: () => void }) {
	const t = useTranslate();
	const [open, setOpen] = useState(false);

	const run = (action: () => void) => () => {
		setOpen(false);
		action();
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: stops row clicks from bubbling out of the menu.
		<div className='flex justify-end' onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
			<Popover onOpenChange={setOpen} open={open}>
				<Popover.Trigger>
					<Button aria-label={t('protected.links.actions.label')} size='icon' variant='ghost'>
						<Button.Icon icon={Ellipsis} />
					</Button>
				</Popover.Trigger>
				<Popover.Content align='end' className='flex w-48 flex-col gap-1 p-1'>
					<Button className='justify-start' onClick={run(onDownloadQr)} variant='ghost'>
						<Button.Icon icon={Download} />
						<Button.Text>{t('protected.links.actions.downloadQr')}</Button.Text>
					</Button>
					<Button className='justify-start' onClick={run(onChangeChannel)} variant='ghost'>
						<Button.Icon icon={Megaphone} />
						<Button.Text>{t('protected.links.actions.changeChannel')}</Button.Text>
					</Button>
					<Button className='justify-start text-destructive' onClick={run(onDelete)} variant='ghost'>
						<Button.Icon icon={Trash2} />
						<Button.Text>{t('protected.links.actions.delete')}</Button.Text>
					</Button>
				</Popover.Content>
			</Popover>
		</div>
	);
}
