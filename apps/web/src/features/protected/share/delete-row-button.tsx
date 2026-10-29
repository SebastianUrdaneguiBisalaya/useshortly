import { Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/actions-controls/button/button';
import { ConfirmDialog } from '~/components/ui/overlays-feedback/confirm-dialog/confirm-dialog';
import { useTranslate } from '~/hooks/use-translate';

/** Icon button for a table row that asks for confirmation before running the (async) deletion. */
export function DeleteRowButton({ label, title, description, onConfirm }: { label: string; title: string; description: string; onConfirm: () => Promise<unknown> }) {
	const t = useTranslate();

	return (
		<ConfirmDialog.Root
			lang={{
				cancel: t('protected.confirm.cancel'),
				confirm: t('protected.confirm.delete'),
			}}
			onConfirm={async () => {
				await onConfirm();
			}}
			variant='destructive'
		>
			<ConfirmDialog.Trigger>
				<Button aria-label={label} size='icon' variant='ghost'>
					<Button.Icon icon={Trash2} />
				</Button>
			</ConfirmDialog.Trigger>
			<ConfirmDialog.Content>
				<ConfirmDialog.Title>{title}</ConfirmDialog.Title>
				<ConfirmDialog.Description>{description}</ConfirmDialog.Description>
				<ConfirmDialog.Footer>
					<ConfirmDialog.Cancel />
					<ConfirmDialog.Confirm />
				</ConfirmDialog.Footer>
			</ConfirmDialog.Content>
		</ConfirmDialog.Root>
	);
}
