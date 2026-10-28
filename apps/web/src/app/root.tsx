import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import { Layout as L } from '~/components/ui/layout/layout/layout';

import type { Route } from './+types/root';
import '~/app/app.css';
import { ToasterProvider } from '~/providers/toast-client';
import { QueryProvider } from '~/providers/query-client';
import { defaultLocale, getI18n, localeFromRequest, readLanguagePreference } from '~/i18n';
import { themeFromRequest } from '~/lib/theme';

export const links: Route.LinksFunction = () => [];

/** Default tab title and description, used by every route that does not export its own `meta` (see `features/auth/layout.tsx`). */
export const meta: Route.MetaFunction = ({ loaderData }) => {
	const t = getI18n(loaderData?.locale).t;
	return [{ title: t('meta.title') }, { name: 'description', content: t('meta.description') }];
};

/** Decides language and theme on the server (stored cookies, else `Accept-Language` / system) so the first paint is already right. */
export function loader({ request }: Route.LoaderArgs) {
	return {
		languagePreference: readLanguagePreference(request.headers.get('cookie')),
		locale: localeFromRequest(request),
		theme: themeFromRequest(request),
	};
}

export function Layout({ children }: { children: React.ReactNode }) {
	const data = useRouteLoaderData<typeof loader>('root');
	const i18n = getI18n(data?.locale ?? defaultLocale);

	return (
		<html data-theme={data?.theme === 'light' || data?.theme === 'dark' ? data.theme : undefined} lang={data?.locale ?? defaultLocale} suppressHydrationWarning>
			<head>
				<meta charSet='utf-8' />
				<meta name='viewport' content='width=device-width, initial-scale=1' />
				<Meta />
				<Links />
			</head>
			<body>
				<L.Container className='flex h-screen w-full flex-col overflow-hidden p-0 sm:p-0 lg:p-0' size='full'>
					<I18nextProvider i18n={i18n}>
						<QueryProvider>{children}</QueryProvider>
					</I18nextProvider>
					<ToasterProvider />
				</L.Container>
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = 'Oops!';
	let details = 'An unexpected error occurred.';
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? '404' : 'Error';
		details = error.status === 404 ? 'The requested page could not be found.' : error.statusText || details;
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<main className='pt-16 p-4 container mx-auto'>
			<h1>{message}</h1>
			<p>{details}</p>
			{stack && (
				<pre className='w-full p-4 overflow-x-auto'>
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}
