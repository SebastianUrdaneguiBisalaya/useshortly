import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useLoginWithGoogle } from '~/api/endpoints/auth/auth';
import { useTranslate } from '~/hooks/use-translate';
import { useSessionStore } from '~/stores/session-store';

/** Google OAuth client id; without it the Google buttons are hidden. Must match the backend's `GOOGLE_CLIENT_ID`. */
const googleClientId: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID;

let scriptPromise: Promise<void> | undefined;

function loadGoogleScript() {
	scriptPromise ??= new Promise<void>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = 'https://accounts.google.com/gsi/client';
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () => {
			scriptPromise = undefined;
			reject(new Error('Google script failed to load'));
		};
		document.head.append(script);
	});
	return scriptPromise;
}

/**
 * Google sign-in with the popup authorization-code flow: Google hands the page a
 * one-time `code`, and the backend (which holds the client secret) exchanges it
 * for the user's identity and opens the session. Request errors are toasted by the query client.
 */
export function useGoogleSignIn() {
	const t = useTranslate();
	const navigate = useNavigate();
	const loginWithGoogle = useLoginWithGoogle();
	const setSession = useSessionStore(state => state.setSession);

	// Load ahead of the click so the popup opens while the click's user activation is still valid.
	useEffect(() => {
		if (googleClientId) void loadGoogleScript().catch(() => {});
	}, []);

	const signIn = async () => {
		if (!googleClientId) return;
		try {
			await loadGoogleScript();
		} catch {
			toast.error(t('errors.generic'));
			return;
		}
		window.google?.accounts.oauth2
			.initCodeClient({
				callback: ({ code }) => {
					// No code means the user closed the popup or denied access; nothing to report.
					if (!code) return;
					loginWithGoogle.mutate(
						{
							data: {
								code,
							},
						},
						{
							onSuccess: response => {
								if (response.data) setSession(response.data);
								void navigate('/', {
									replace: true,
								});
							},
						}
					);
				},
				client_id: googleClientId,
				scope: 'openid email profile',
				ux_mode: 'popup',
			})
			.requestCode();
	};

	return {
		enabled: Boolean(googleClientId),
		isPending: loginWithGoogle.isPending,
		signIn,
	};
}
