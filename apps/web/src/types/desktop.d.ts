/** The bridge the desktop app's preload (`apps/desktop/src/preload.cts`) exposes; absent in a regular browser. */
interface Window {
	desktop?: {
		/** Signs in with Google through the system browser; null when the user cancelled. */
		googleSignIn: (clientId: string) => Promise<{ code: string; codeVerifier: string; redirectUri: string } | null>;
		version: string;
	};
}
