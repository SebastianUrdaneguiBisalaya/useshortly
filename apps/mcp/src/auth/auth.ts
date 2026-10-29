import { betterAuth } from 'better-auth';
import type { authOptions } from './options.js';

/** Builds Better Auth from options whose migrations have already run (it checks the schema on creation). */
export function createAuth(options: ReturnType<typeof authOptions>) {
	return betterAuth(options);
}

export type Auth = ReturnType<typeof createAuth>;
