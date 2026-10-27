import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import * as z from 'zod';

/**
 * Starts a Better Auth session for a user the API has already authenticated. The endpoint is
 * server-only (SERVER_ONLY): it has no HTTP route, so it can only be reached by code in this
 * process, after the API vouched for the identity. Never expose it.
 *
 * mcp_user is keyed by the API's user id. When the API's data changes (new email or name) the
 * next sign-in refreshes it; when an old row holds the email of a different API user (the
 * account was deleted and the email registered again) that row is stale and is removed with
 * the tokens it owns.
 */
export const delegatedSession = () =>
	({
		id: 'delegated-session',
		endpoints: {
			createDelegatedSession: createAuthEndpoint(
				'/delegated-session',
				{
					method: 'POST',
					body: z.object({
						apiUserId: z.number().int().positive(),
						email: z.string().min(1),
						emailVerified: z.boolean(),
						name: z.string().min(1),
						image: z.string().nullish(),
					}),
					metadata: { SERVER_ONLY: true },
				},
				async ctx => {
					const { apiUserId, email, emailVerified, name, image } = ctx.body;
					const { adapter, internalAdapter } = ctx.context;

					const byApiId = await adapter.findOne<{ id: string }>({
						model: 'user',
						where: [{ field: 'apiUserId', value: apiUserId }],
					});
					const holder = await internalAdapter.findUserByEmail(email);
					if (holder && holder.user.id !== byApiId?.id) await internalAdapter.deleteUser(holder.user.id);

					const data = { email, emailVerified, name, image: image ?? null };
					const user = byApiId ? await internalAdapter.updateUser(byApiId.id, data) : await internalAdapter.createUser({ ...data, apiUserId }, { method: 'api-delegated' });
					if (!user) throw ctx.error('INTERNAL_SERVER_ERROR', { message: 'could not save the user' });

					const session = await internalAdapter.createSession(user.id);
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ userId: user.id });
				}
			),
		},
	}) satisfies BetterAuthPlugin;
