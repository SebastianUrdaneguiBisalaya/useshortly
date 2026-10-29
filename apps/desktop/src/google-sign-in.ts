import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { shell } from 'electron';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
// The user may take a while in the browser (account picker, 2FA), but not forever.
const TIMEOUT_MS = 5 * 60 * 1000;

/** What the backend's POST /auth/google needs to trade the code with the "Desktop app" client. */
export interface GoogleGrant {
	code: string;
	codeVerifier: string;
	redirectUri: string;
}

let cancelPending: (() => void) | null = null;

function base64url(buffer: Buffer) {
	return buffer.toString('base64url');
}

function page(message: string) {
	return `<!doctype html><html><head><meta charset="utf-8"><title>useshortly</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><p>${message}</p></body></html>`;
}

/**
 * Google sign-in for the desktop app (RFC 8252): Google refuses to sign in inside embedded
 * browsers like Electron's, so the consent screen opens in the system browser and Google
 * redirects back to a one-shot server on the loopback interface. PKCE ties the code to this
 * process and `state` ties the redirect to this request.
 *
 * Resolves with the grant, or null when the user denied access, gave up (timeout) or started
 * another sign-in. Only real failures (the loopback server or the browser could not start) reject.
 */
export function signInWithGoogle(clientId: string): Promise<GoogleGrant | null> {
	cancelPending?.();

	const codeVerifier = base64url(randomBytes(32));
	const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
	const state = base64url(randomBytes(16));

	return new Promise((resolve, reject) => {
		let redirectUri = '';
		let timer: NodeJS.Timeout | undefined;

		const stop = () => {
			clearTimeout(timer);
			if (cancelPending === cancel) cancelPending = null;
			server.close();
			// Drop the browser's keep-alive connection too, or close() waits for it.
			server.closeAllConnections();
		};
		const finish = (grant: GoogleGrant | null) => {
			stop();
			resolve(grant);
		};
		const fail = (error: unknown) => {
			stop();
			reject(error);
		};
		const cancel = () => finish(null);
		cancelPending = cancel;

		const server = createServer((req, res) => {
			const url = new URL(req.url ?? '/', redirectUri);
			// Anything else (favicon, a stray request, a forged redirect without our state) is ignored
			// and the real redirect is still awaited.
			if (url.pathname !== '/' || url.searchParams.get('state') !== state) {
				res.writeHead(404).end();
				return;
			}
			const code = url.searchParams.get('code');
			res.writeHead(200, {
				'Content-Type': 'text/html; charset=utf-8',
			});
			res.end(page(code ? 'Signed in. You can close this tab and return to useshortly.' : 'Sign-in was cancelled. You can close this tab.'));
			finish(
				code
					? {
							code,
							codeVerifier,
							redirectUri,
						}
					: null
			);
		});

		server.on('error', fail);

		// Port 0: the OS picks a free one; the "Desktop app" client accepts any loopback port.
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			redirectUri = `http://127.0.0.1:${port}`;
			const authUrl = new URL(AUTH_URL);
			authUrl.search = new URLSearchParams({
				client_id: clientId,
				code_challenge: codeChallenge,
				code_challenge_method: 'S256',
				prompt: 'select_account',
				redirect_uri: redirectUri,
				response_type: 'code',
				scope: 'openid email profile',
				state,
			}).toString();
			timer = setTimeout(cancel, TIMEOUT_MS);
			shell.openExternal(authUrl.toString()).catch(fail);
		});
	});
}
