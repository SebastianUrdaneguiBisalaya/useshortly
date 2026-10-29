import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Auth } from '../auth/auth.js';
import { basePath } from '../auth/options.js';
import { isChoosable, scopeDescriptions, scopes } from '../auth/scopes.js';
import type { Config } from '../config.js';
import { Layout } from './layout.js';
import { newNonce, pageSecurity, sameOrigin } from './security.js';

const messages = {
	expired: 'This authorization request is invalid or has expired. Start again from your MCP client.',
	signedOut: 'Your session ended. Start again from your MCP client to sign in.',
	nothing: 'Choose at least one permission, or deny access.',
} as const;
type Problem = keyof typeof messages;

type View = {
	query: string;
	clientName: string;
	clientId: string;
	returnTo: string;
	user: { name: string; email: string };
	requested: string[];
};

const validQuery = (q: unknown): q is string => typeof q === 'string' && q.length <= 4096 && new URLSearchParams(q).has('sig') && new URLSearchParams(q).has('client_id');

const hostOf = (value: string | null): string => {
	try {
		return new URL(value ?? '').host || (value ?? '');
	} catch {
		return value ?? '';
	}
};

export function consentRoutes({ config, auth }: { config: Config; auth: Auth }) {
	const app = new Hono();

	const shell = (c: Context, status: 200 | 400 | 401, body: (nonce: string) => unknown) => {
		const nonce = newNonce();
		pageSecurity(c, nonce, { google: false });
		c.status(status);
		return c.html(
			<Layout title='Authorize · useshortly' nonce={nonce}>
				{body(nonce) as never}
			</Layout>
		);
	};

	const failure = (c: Context, problem: Problem, status: 400 | 401 = 400) =>
		shell(c, status, () => (
			<>
				<h1>Authorization</h1>
				<div class='error' role='alert'>
					{messages[problem]}
				</div>
			</>
		));

	/** Everything the screen shows comes from the signed request, the session and the stored client. */
	const load = async (c: Context, query: string): Promise<View | Problem> => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return 'signedOut';
		const params = new URLSearchParams(query);
		const clientId = params.get('client_id') ?? '';
		const client = await auth.api.getOAuthClientPublic({ query: { client_id: clientId }, headers: c.req.raw.headers }).catch(() => null);
		if (!client) return 'expired';
		return {
			query,
			clientId,
			clientName: client.client_name || hostOf(clientId) || clientId,
			returnTo: hostOf(params.get('redirect_uri')),
			user: { name: session.user.name, email: session.user.email },
			requested: (params.get('scope') ?? '').split(' ').filter(Boolean),
		};
	};

	const screen = (c: Context, v: View, problem?: Problem, status: 200 | 400 = 200) =>
		shell(c, status, () => (
			<>
				<h1>Authorize {v.clientName}</h1>
				<p>
					<span class='who'>{v.clientName}</span> ({v.clientId.startsWith('http') ? hostOf(v.clientId) : v.clientId}) wants to access the useshortly account of{' '}
					<span class='who'>{v.user.email}</span>.
				</p>
				<form method='post' action='/consent'>
					<input type='hidden' name='oauth_query' value={v.query} />
					<ul class='scopes'>
						{v.requested.map(scope => {
							const info = scopeDescriptions[scope] ?? { title: scope, detail: 'Requested by the client.' };
							return (
								<li class='scope'>
									{isChoosable(scope) ? <input type='checkbox' name='scope' value={scope} id={`s-${scope}`} checked /> : <span aria-hidden='true'>•</span>}
									<label for={`s-${scope}`}>
										{info.title}
										<small>{info.detail}</small>
									</label>
								</li>
							);
						})}
					</ul>
					<p>
						After you decide you will go back to <span class='who'>{v.returnTo}</span>. Only allow clients you trust.
					</p>
					<div class='row'>
						<button type='submit' name='decision' value='deny' class='secondary'>
							Deny
						</button>
						<button type='submit' name='decision' value='allow'>
							Allow
						</button>
					</div>
					<div class='error' role='alert' hidden={!problem}>
						{problem ? messages[problem] : ''}
					</div>
				</form>
			</>
		));

	app.get('/consent', async c => {
		const query = new URL(c.req.url).search.slice(1);
		if (!validQuery(query)) return failure(c, 'expired');
		const view = await load(c, query);
		if (typeof view === 'string') return failure(c, view, view === 'signedOut' ? 401 : 400);
		return screen(c, view);
	});

	app.post('/consent', sameOrigin(config.publicUrl), async c => {
		const form = await c.req.parseBody({ all: true });
		const query = form.oauth_query;
		if (!validQuery(query)) return failure(c, 'expired');
		const view = await load(c, query);
		if (typeof view === 'string') return failure(c, view, view === 'signedOut' ? 401 : 400);

		const accept = form.decision === 'allow';
		// Only what the signed request asked for can be granted; the form can only narrow it.
		const ticked = new Set([form.scope ?? []].flat().filter((s): s is string => typeof s === 'string'));
		const granted = view.requested.filter(s => !isChoosable(s) || ticked.has(s));
		if (accept && !granted.some(isChoosable) && view.requested.some(isChoosable)) {
			return screen(c, view, 'nothing', 400);
		}

		// The provider resumes the authorization from a real Request, so go through its handler
		// (in process, no network) with the user's cookie, as the browser would.
		const res = await auth.handler(
			new Request(`${config.publicUrl}${basePath}/oauth2/consent`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					origin: new URL(config.publicUrl).origin,
					cookie: c.req.header('cookie') ?? '',
				},
				body: JSON.stringify({ accept, scope: accept ? granted.join(' ') : undefined, oauth_query: query }),
			})
		);
		const result = (await res.json().catch(() => null)) as { url?: unknown } | null;
		if (!res.ok || typeof result?.url !== 'string') return failure(c, 'expired');
		return new Response(null, { status: 303, headers: { Location: result.url, 'Cache-Control': 'no-store' } });
	});

	return app;
}
