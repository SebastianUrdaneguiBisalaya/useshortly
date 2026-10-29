import { Input } from '~/components/ui/forms-inputs/input/input';
import { Layout } from '~/components/ui/layout/layout/layout';
import { Image } from '~/components/ui/media-files/image/image';
import { SettingsDialog } from '~/components/ui/overlays-feedback/settings-dialog/settings-dialog';
import { useTranslate } from '~/hooks/use-translate';
import { useSessionStore } from '~/stores/session-store';
import { DeleteAccountButton } from './delete-account';

/** `Account` tab of the settings dialog: read-only profile, and the danger zone. */
export function AccountSettings() {
	const t = useTranslate();
	const user = useSessionStore(state => state.session?.user);
	if (!user) return null;

	const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
	const initials = (user.first_name || user.email || '?').slice(0, 2).toUpperCase();
	const providers = (user.providers ?? []).map(provider => (provider === 'GOOGLE' || provider === 'DEFAULT' ? t(`protected.account.providers.${provider}`) : provider)).join(', ');

	return (
		<Layout.Stack gap='lg'>
			<Layout.Section className='py-0'>
				<SettingsDialog.Section title={t('protected.account.profile.title')}>
					<Layout.Stack className='pt-2'>
						<Image aria-label={t('protected.account.profile.photo')} className='size-16 rounded-full' role='img'>
							{user.image_url ? (
								<>
									<Image.Img alt={name} referrerPolicy='no-referrer' src={user.image_url} />
									<Image.Skeleton />
									<Image.Fallback>{initials}</Image.Fallback>
								</>
							) : (
								<div className='absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground'>{initials}</div>
							)}
						</Image>
						<ReadOnlyField label={t('protected.account.profile.name')} value={name} />
						<ReadOnlyField label={t('protected.account.profile.email')} value={user.email ?? ''} />
						<ReadOnlyField label={t('protected.account.profile.provider')} value={providers} />
					</Layout.Stack>
				</SettingsDialog.Section>
			</Layout.Section>
			<Layout.Section>
				<SettingsDialog.Section title={t('protected.account.danger.title')}>
					<SettingsDialog.Row description={t('protected.account.danger.description')} label={t('protected.account.danger.label')}>
						<DeleteAccountButton />
					</SettingsDialog.Row>
				</SettingsDialog.Section>
			</Layout.Section>
		</Layout.Stack>
	);
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
	return (
		<Input>
			<Input.Label>{label}</Input.Label>
			<Input.Field readOnly value={value} />
		</Input>
	);
}
