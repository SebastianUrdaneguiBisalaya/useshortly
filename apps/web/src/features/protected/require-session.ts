import { redirect } from 'react-router';
import { renewSession } from '~/api/axios-instance';
import { useSessionStore } from '~/stores/session-store';

function isPast(isoDate: string | undefined) {
	return !isoDate || Date.parse(isoDate) <= Date.now();
}

/**
 * Guard for protected routes: returns once there is a usable session, otherwise
 * redirects to sign-in. An expired access token is renewed up front with the
 * refresh cookie; if that is expired or rejected too, the session is dropped.
 */
export async function requireSession() {
	const { session, clearSession } = useSessionStore.getState();
	if (!session || isPast(session.refresh_expires_at)) {
		clearSession();
		throw redirect('/auth/sign-in');
	}
	if (isPast(session.expires_at) && !(await renewSession())) {
		throw redirect('/auth/sign-in');
	}
}
