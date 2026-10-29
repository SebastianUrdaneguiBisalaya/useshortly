import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { signInWithGoogle } from './google-sign-in.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = !app.isPackaged;
const WEB_PORT = 4173;
const WEB_URL = isDev ? 'http://localhost:5173' : `http://127.0.0.1:${WEB_PORT}`;

let webServerProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

// In dev, `apps/web`'s own `pnpm dev` (vite) is expected to already be running.
// In production, we spawn its SSR server locally and only ever load from that
// known local origin - never a remote or attacker-controlled URL.
function startWebServer() {
	if (isDev) return;

	const webServerEntry = path.join(process.resourcesPath, 'web', 'build', 'server', 'index.js');

	webServerProcess = spawn(process.execPath, [webServerEntry], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			PORT: String(WEB_PORT),
		},
		stdio: 'inherit',
	});

	webServerProcess.on('exit', code => {
		if (code && code !== 0) {
			console.error(`web server exited with code ${code}`);
		}
	});
}

function stopWebServer() {
	webServerProcess?.kill();
	webServerProcess = null;
}

function isTrustedUrl(url: string) {
	return url === WEB_URL || url.startsWith(`${WEB_URL}/`);
}

function createWindow() {
	mainWindow = new BrowserWindow({
		height: 800,
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
		width: 1280,
	});

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

	mainWindow.once('ready-to-show', () => mainWindow?.show());

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
		startWebServer();
		createWindow();
	});

	app.on('window-all-closed', () => {
		stopWebServer();
		if (process.platform !== 'darwin') app.quit();
	});

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});

	app.on('before-quit', stopWebServer);
}
