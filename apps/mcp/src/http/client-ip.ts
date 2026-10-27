import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

/**
 * The visitor's address. Behind a trusted proxy it is the last X-Forwarded-For entry, the one
 * the proxy itself appended; otherwise a client could put anything in the header.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
	if (trustProxy) {
		const last = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
		if (last) return last;
	}
	try {
		return getConnInfo(c).remote.address ?? 'unknown';
	} catch {
		return 'unknown';
	}
}
