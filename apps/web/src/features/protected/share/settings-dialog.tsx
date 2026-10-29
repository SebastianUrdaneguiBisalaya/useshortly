import { SlidersHorizontal, User } from 'lucide-react';
import { SwitchTheme } from '~/components/ui/actions-controls/switch-theme/switch-theme';
import { Select } from '~/components/ui/forms-inputs/select/select';
import { Layout } from '~/components/ui/layout/layout/layout';
import { SettingsDialog as SettingsDialogUi } from '~/components/ui/overlays-feedback/settings-dialog/settings-dialog';
import { useLanguage } from '~/hooks/use-language';
import { useTheme } from '~/hooks/use-theme';
import { useTranslate } from '~/hooks/use-translate';
import type { LanguagePreference } from '~/i18n';
import { AccountSettings } from './account-settings';

/** Account settings: `General` (theme and language) and `Account` (profile and danger zone). */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const theme = useTheme();
	const language = useLanguage();

	return (
		<SettingsDialogUi.Root
			defaultValue='general'
			lang={{
				close: t('protected.settings.close'),
				noResults: t('protected.settings.noResults'),
				searchPlaceholder: t('protected.settings.search'),
				title: t('protected.nav.settings'),
			}}
			onOpenChange={onOpenChange}
			open={open}
		>
			<SettingsDialogUi.Content>
				<SettingsDialogUi.Sidebar>
					<SettingsDialogUi.Search />
					<SettingsDialogUi.Nav>
						<SettingsDialogUi.Group label={t('protected.nav.settings')}>
							<SettingsDialogUi.Item icon={SlidersHorizontal} value='general'>
								{t('protected.settings.general')}
							</SettingsDialogUi.Item>
							<SettingsDialogUi.Item icon={User} value='account'>
								{t('protected.settings.account')}
							</SettingsDialogUi.Item>
						</SettingsDialogUi.Group>
					</SettingsDialogUi.Nav>
				</SettingsDialogUi.Sidebar>
				<SettingsDialogUi.Main>
					<SettingsDialogUi.Panel value='general' className='pr-0'>
						<Layout.Stack>
							<Layout.Section className='py-0'>
								<SettingsDialogUi.Section title={t('protected.settings.appearance')}>
									<SettingsDialogUi.Row label={t('theme.group')}>
										<SwitchTheme
											lang={{
												dark: t('theme.dark'),
												groupLabel: t('theme.group'),
												light: t('theme.light'),
												system: t('theme.system'),
											}}
											onValueChange={theme.setPreference}
											value={theme.preference}
										/>
									</SettingsDialogUi.Row>
									<SettingsDialogUi.Row label={t('language.group')}>
										<Select.Root<LanguagePreference> onChange={language.setPreference} value={language.preference}>
											<Select.Trigger aria-label={t('language.group')}>
												<Select.Value />
											</Select.Trigger>
											<Select.Content>
												<Select.ItemList>
													<Select.Item value='system'>{t('language.system')}</Select.Item>
													<Select.Item value='es'>{t('language.es')}</Select.Item>
													<Select.Item value='en'>{t('language.en')}</Select.Item>
												</Select.ItemList>
											</Select.Content>
										</Select.Root>
									</SettingsDialogUi.Row>
								</SettingsDialogUi.Section>
							</Layout.Section>
						</Layout.Stack>
					</SettingsDialogUi.Panel>
					<SettingsDialogUi.Panel value='account' className='pr-0'>
						<AccountSettings />
					</SettingsDialogUi.Panel>
				</SettingsDialogUi.Main>
			</SettingsDialogUi.Content>
		</SettingsDialogUi.Root>
	);
}
