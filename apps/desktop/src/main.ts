import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { signInWithGoogle } from './google-sign-in.js';
import { loadWindowState, trackWindowState, windowOptions } from './window-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The app only embeds the web app, it does not ship it. It loads the web app from this URL: the
// vite dev server by default, or a deployed/self-hosted one through USESHORTLY_WEB_URL.
const WEB_URL = (process.env.USESHORTLY_WEB_URL ?? 'http://localhost:5173').replace(/\/+$/, '');

let mainWindow: BrowserWindow | null = null;

function isTrustedUrl(url: string) {
	return url === WEB_URL || url.startsWith(`${WEB_URL}/`);
}

function createWindow() {
	const windowState = loadWindowState();

	mainWindow = new BrowserWindow({
		...windowOptions(windowState),
		show: false,
		webPreferences: {
			allowRunningInsecureContent: false,
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, 'preload.cjs'),
			sandbox: true,
			spellcheck: false,
			webSecurity: true,
		},
	});

	trackWindowState(mainWindow);

	// Never let the renderer open arbitrary windows/navigations to a
	// different origin - only our own local app URL is allowed in-app,
	// everything else is handed off to the OS browser.
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (!isTrustedUrl(url)) {
			shell.openExternal(url);
			return {
				action: 'deny',
			};
		}
		return {
			action: 'allow',
		};
	});

	mainWindow.webContents.on('will-navigate', (event, url) => {
		if (!isTrustedUrl(url)) {
			event.preventDefault();
			shell.openExternal(url);
		}
	});

	// Reopen how the user left it; the first launch fills the work area
	// (maximized, not fullscreen: menu bar/taskbar and dock stay visible).
	mainWindow.once('ready-to-show', () => {
		if (windowState.isMaximized) mainWindow?.maximize();
		mainWindow?.show();
	});

	mainWindow.loadURL(WEB_URL).catch(error => {
		console.error('Failed to load web app', error);
	});

	mainWindow.on('closed', () => {
		mainWindow = null;
	});
}

// A Google OAuth client id; it goes into the Google URL opened in the system browser.
const GOOGLE_CLIENT_ID = /^[\w.-]+\.apps\.googleusercontent\.com$/;

function registerIpc() {
	ipcMain.handle('google-sign-in', async (event, clientId: unknown) => {
		// Only our own app may start a sign-in, never a page it navigated to.
		if (!isTrustedUrl(event.senderFrame?.url ?? '')) throw new Error('Untrusted sender');
		if (typeof clientId !== 'string' || !GOOGLE_CLIENT_ID.test(clientId)) throw new Error('Invalid Google client id');
		const grant = await signInWithGoogle(clientId);
		// The user finished in the browser; bring them back to the app.
		if (grant && mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.show();
			mainWindow.focus();
		}
		return grant;
	});
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
	// Another instance is already running - let it keep running and quit this one.
	app.quit();
} else {
	app.on('second-instance', () => {
		if (!mainWindow) return;
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	});

	app.whenReady().then(() => {
		registerIpc();
		createWindow();
	});

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
}
