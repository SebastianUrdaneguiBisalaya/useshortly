import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { getListLinksQueryKey, useSetLinkQrStyle } from '~/api/endpoints/links/links';
import type { Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { ColorPicker } from '~/components/ui/data-display/color-picker/color-picker';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { HEX_COLOR, isScannable } from '../share/qr-contrast';
import { DEFAULT_QR_BACKGROUND, DEFAULT_QR_FOREGROUND, QrImage } from '../share/qr-image';

/** Dialog to change a link's QR colors and logo, with a live preview. Mount it only while open so the draft always starts from the saved style. */
export function QrStyleDialog({ orgID, link, onOpenChange }: { orgID: number; link: Link; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const setStyle = useSetLinkQrStyle();
	const [foreground, setForeground] = useState(link.qr_style?.foreground || DEFAULT_QR_FOREGROUND);
	const [background, setBackground] = useState(link.qr_style?.background || DEFAULT_QR_BACKGROUND);
	const [logoUrl, setLogoUrl] = useState(link.qr_style?.logo_url ?? '');

	const logo = logoUrl.trim();
	const colorsValid = HEX_COLOR.test(foreground) && HEX_COLOR.test(background);
	const logoValid = logo === '' || /^https:\/\/\S+$/.test(logo);
	const error = !colorsValid
		? t('protected.qr.style.invalidColor')
		: !isScannable(foreground, background)
			? t('protected.qr.style.lowContrast')
			: !logoValid
				? t('protected.qr.style.invalidLogo')
				: undefined;
	const preview = { background, foreground, logo_url: logoValid && logo ? logo : undefined };

	const save = (data: { background?: string; foreground?: string; logo_url?: string }) =>
		setStyle.mutate(
			{ data, linkID: link.id as number, orgID },
			{
				onSuccess: async () => {
					await queryClient.invalidateQueries({ queryKey: getListLinksQueryKey(orgID) });
					toast.success(t('protected.toast.qrStyleSaved'));
					onOpenChange(false);
				},
			}
		);

	return (
		<Modal.Root onOpenChange={onOpenChange} open>
			<Modal.Content aria-labelledby={titleId} className='max-w-2xl'>
				<Modal.Header>
					<Modal.Title id={titleId}>{t('protected.qr.style.title')}</Modal.Title>
					<Modal.Description>/{link.code}</Modal.Description>
				</Modal.Header>
				<Modal.Body>
					<div className='grid gap-6 sm:grid-cols-[auto_1fr]'>
						<div className='flex items-start justify-center'>
							{link.short_url && (
								<div className='overflow-hidden rounded-lg border border-border'>
									<QrImage size={192} style={preview} value={link.short_url} />
								</div>
							)}
						</div>
						<div className='flex flex-col gap-4'>
							<ColorField label={t('protected.qr.style.foreground')} onChange={setForeground} value={foreground} />
							<ColorField label={t('protected.qr.style.background')} onChange={setBackground} value={background} />
							<Input errorMessage={logoValid ? undefined : t('protected.qr.style.invalidLogo')}>
								<Input.Label>{t('protected.qr.style.logo')}</Input.Label>
								<Input.Help description={t('protected.qr.style.logoHint')} />
								<Input.Field autoComplete='off' inputMode='url' onChange={event => setLogoUrl(event.target.value)} placeholder='https://example.com/logo.png' value={logoUrl} />
							</Input>
							{error && (
								<p className='font-primary text-sm text-destructive' role='alert'>
									{error}
								</p>
							)}
						</div>
					</div>
				</Modal.Body>
				<Modal.Footer>
					<Button
						disabled={setStyle.isPending}
						onClick={() => {
							setForeground(DEFAULT_QR_FOREGROUND);
							setBackground(DEFAULT_QR_BACKGROUND);
							setLogoUrl('');
							save({});
						}}
						type='button'
						variant='ghost'
					>
						<Button.Icon icon={RotateCcw} />
						<Button.Text>{t('protected.qr.style.reset')}</Button.Text>
					</Button>
					<Modal.Close>
						<Button type='button' variant='secondary'>
							<Button.Text>{t('protected.confirm.cancel')}</Button.Text>
						</Button>
					</Modal.Close>
					<Button
						disabled={error !== undefined || setStyle.isPending}
						onClick={() =>
							save({
								background: background === DEFAULT_QR_BACKGROUND ? undefined : background.toLowerCase(),
								foreground: foreground === DEFAULT_QR_FOREGROUND ? undefined : foreground.toLowerCase(),
								logo_url: logo || undefined,
							})
						}
						type='button'
					>
						<Button.Text>{setStyle.isPending ? t('protected.qr.style.saving') : t('protected.qr.style.save')}</Button.Text>
					</Button>
				</Modal.Footer>
			</Modal.Content>
		</Modal.Root>
	);
}

/** Labelled `ColorPicker`: gradient, hex field and eyedropper in a popover. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	const labelId = useId();

	return (
		<div className='flex flex-col gap-1.5'>
			<span className='font-primary text-sm font-medium text-foreground' id={labelId}>
				{label}
			</span>
			<ColorPicker onValueChange={onChange} value={value}>
				<ColorPicker.Trigger aria-label={label} />
				<ColorPicker.Content aria-label={label}>
					<ColorPicker.Gradient />
					<div className='flex items-center gap-2'>
						<ColorPicker.HexField />
						<ColorPicker.EyeDropper />
					</div>
				</ColorPicker.Content>
			</ColorPicker>
		</div>
	);
}
