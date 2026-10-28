import { useNavigate } from 'react-router';
import { useLogout } from '~/api/endpoints/auth/auth';
import { Button } from '~/components/ui/actions-controls/button/button';
import { useTranslate } from '~/hooks/use-translate';
import { useSessionStore } from '~/stores/session-store';

export default function SettingsPage() {
	const t = useTranslate();
	const navigate = useNavigate();
	const logout = useLogout();
	const clearSession = useSessionStore(state => state.clearSession);

	return (
		<Button
			lang={{
				loadingText: t('protected.settings.loggingOut'),
			}}
			loading={logout.isPending}
			onClick={() =>
				logout.mutate(undefined, {
					// The local session goes even if the request fails: the user asked to leave.
					onSettled: () => {
						clearSession();
						void navigate('/auth/sign-in', {
							replace: true,
						});
					},
				})
			}
			variant='secondary'
		>
			<Button.Text>{t('protected.settings.logout')}</Button.Text>
		</Button>
	);
}
