import axios, { type AxiosError, type AxiosRequestConfig, isAxiosError } from 'axios';
import { useSessionStore } from '~/stores/session-store';

import type { ErrorResponse, SessionResponse } from './model';

declare module 'axios' {
	interface AxiosRequestConfig {
		/** Set once a request was replayed after a refresh, so it is never replayed twice. */
		_retried?: boolean;
	}
}

// Empty in development: Vite proxies /api to the backend (see vite.config.ts), so the browser
// stays on one origin and the backend needs no CORS. The session travels in httpOnly cookies, which
// the browser attaches by itself; no token is ever handled here.
const apiClient = axios.create({
	baseURL: `${import.meta.env.VITE_API_URL ?? ''}/api/v1`,
});

let refreshing: Promise<boolean> | undefined;

/**
 * Swaps the refresh cookie for a new session. Resolves `true` when the session was renewed.
 * Only one call runs at a time and concurrent callers share it: refresh tokens rotate, so a second
 * call with the old token would look like theft and the backend would revoke every session.
 * A rejected refresh token (401) also drops the stored session.
 */
export function renewSession(): Promise<boolean> {
	refreshing ??= apiClient
		.post<SessionResponse>('/auth/refresh')
		.then(({ data }) => {
			if (!data.data) return false;
			useSessionStore.getState().setSession(data.data);
			return true;
		})
		.catch((error: unknown) => {
			if (isAxiosError(error) && error.response?.status === 401) {
				useSessionStore.getState().clearSession();
			}
			return false;
		})
		.finally(() => {
			refreshing = undefined;
		});
	return refreshing;
}

// An expired access token answers 401: renew the session once and replay the request, so callers
// never see it. The /auth/* endpoints are excluded: their 401 means wrong credentials or no session.
apiClient.interceptors.response.use(undefined, async (error: unknown) => {
	if (isAxiosError(error) && error.response?.status === 401 && error.config && !error.config._retried && !error.config.url?.startsWith('/auth/') && (await renewSession())) {
		error.config._retried = true;
		return apiClient(error.config);
	}
	throw error;
});

/** The mutator Orval calls for every generated request. It returns the body, not the axios response. */
export const customInstance = <T>(config: AxiosRequestConfig, options?: AxiosRequestConfig): Promise<T> => apiClient({ ...config, ...options }).then(({ data }) => data as T);

/** Failures carry the API's {"error": {code, message, details}} body in `error.response.data`. */
export type ErrorType<E = ErrorResponse> = AxiosError<E>;
export type BodyType<B> = B;
