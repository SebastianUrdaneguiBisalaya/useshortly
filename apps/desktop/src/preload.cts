// CommonJS on purpose (.cts -> .cjs): sandboxed preloads cannot be ES modules.
import electron = require('electron');

// Only explicit, narrow bridges here - never the full `ipcRenderer` or any Node API.
electron.contextBridge.exposeInMainWorld('desktop', {
	// Google sign-in through the system browser; resolves with { code, codeVerifier, redirectUri }, or null if cancelled.
	googleSignIn: (clientId: string) => electron.ipcRenderer.invoke('google-sign-in', clientId),
	version: process.versions.electron,
});
