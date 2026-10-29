import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncLoop } from './sync-loop.js';

function fakeDb() {
	const calls: string[] = [];
	return {
		calls,
		pullError: undefined as Error | undefined,
		async pull() {
			calls.push('pull');
			if (this.pullError) throw this.pullError;
			return true;
		},
		async push() {
			calls.push('push');
		},
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SyncLoop', () => {
	it('pulls then pushes every interval', async () => {
		const db = fakeDb();
		const loop = new SyncLoop(db, 1000, () => {});
		loop.start();
		await vi.advanceTimersByTimeAsync(2100);
		expect(db.calls).toEqual(['pull', 'push', 'pull', 'push']);
		await loop.stop();
	});

	it('does not start a round while another is running', async () => {
		const db = fakeDb();
		const loop = new SyncLoop(db, 1000, () => {});
		await Promise.all([loop.round(), loop.round()]);
		expect(db.calls).toEqual(['pull', 'push']);
	});

	it('logs a failed round and keeps going', async () => {
		const db = fakeDb();
		const log = vi.fn();
		const loop = new SyncLoop(db, 1000, log);
		loop.start();
		db.pullError = new Error('offline');
		await vi.advanceTimersByTimeAsync(1100);
		expect(log).toHaveBeenCalledWith('turso: sync round failed', db.pullError);
		db.pullError = undefined;
		await vi.advanceTimersByTimeAsync(1000);
		expect(db.calls.at(-1)).toBe('push');
		await loop.stop();
	});

	it('pushes once more on stop and stops ticking', async () => {
		const db = fakeDb();
		const loop = new SyncLoop(db, 1000, () => {});
		loop.start();
		await loop.stop();
		expect(db.calls).toEqual(['push']);
		await vi.advanceTimersByTimeAsync(5000);
		expect(db.calls).toEqual(['push']);
	});

	it('logs a failed final push instead of throwing', async () => {
		const db = fakeDb();
		db.push = async () => {
			throw new Error('offline');
		};
		const log = vi.fn();
		await new SyncLoop(db, 1000, log).stop();
		expect(log).toHaveBeenCalledWith('turso: final push failed', expect.any(Error));
	});
});
