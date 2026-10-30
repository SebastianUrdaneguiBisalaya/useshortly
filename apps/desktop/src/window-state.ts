import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow, type Rectangle, screen } from 'electron';

export type WindowState = {
	bounds?: Rectangle;
	isMaximized: boolean;
};

// Size the window restores to when un-maximized on the first launch.
const DEFAULT_SIZE = { height: 800, width: 1280 };

function stateFile() {
	return path.join(app.getPath('userData'), 'window-state.json');
}

function isRectangle(value: unknown): value is Rectangle {
	if (typeof value !== 'object' || value === null) return false;
	const rect = value as Record<string, unknown>;
	return ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]));
}

// The saved position may belong to a monitor that is no longer connected;
// only reuse it when it still overlaps a display, otherwise let the OS center it.
function isVisible(bounds: Rectangle) {
	return screen.getAllDisplays().some(({ workArea }) => {
		return bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x && bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y;
	});
}

// No saved state (first launch) or an unreadable file means: open maximized.
export function loadWindowState(): WindowState {
	try {
		const saved: unknown = JSON.parse(readFileSync(stateFile(), 'utf8'));
		if (typeof saved !== 'object' || saved === null) throw new Error('Invalid window state');
		const { bounds, isMaximized } = saved as Record<string, unknown>;
		return {
			bounds: isRectangle(bounds) && isVisible(bounds) ? bounds : undefined,
			isMaximized: isMaximized === true,
		};
	} catch {
		return { isMaximized: true };
	}
}

export function windowOptions(state: WindowState) {
	return state.bounds ?? DEFAULT_SIZE;
}

// Saves on close the size/position the window had before being maximized,
// so un-maximizing on the next launch goes back to what the user chose.
export function trackWindowState(window: BrowserWindow) {
	window.on('close', () => {
		const state: WindowState = {
			bounds: window.getNormalBounds(),
			isMaximized: window.isMaximized() || window.isFullScreen(),
		};
		try {
			writeFileSync(stateFile(), JSON.stringify(state));
		} catch (error) {
			console.error('Failed to save window state', error);
		}
	});
}
