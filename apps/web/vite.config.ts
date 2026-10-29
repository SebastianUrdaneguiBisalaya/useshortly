import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const target = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080';
/** First path segment of every page of the web app: they are never short links. */
const APP_PAGES = ['auth', 'links', 'qr-code', 'campaigns', 'domains', 'users', 'api-keys', 'docs', 'mcp'];

export default defineConfig({
	plugins: [tailwindcss(), reactRouter()],
	resolve: {
		tsconfigPaths: true,
	},
	server: {
		// The backend has no CORS: in development the browser talks to Vite, which forwards the API and the short links.
		proxy: {
			// Regex (leading `^`) so `/api-keys`, a page, is not forwarded as if it were `/api/...`.
			'^/api/': target,
			// Short links (`/{code}`, 1-15 characters, optionally with a query) and the unlock form, except the app's own pages.
			// Keep the pages in sync with src/app/routes.ts and the reserved aliases in internal/domain/link/alias.go.
			[`^/(?!(?:${APP_PAGES.join('|')})(?:\\?.*)?$)[0-9A-Za-z_-]{1,15}(?:/unlock)?(?:\\?.*)?$`]: target,
		},
	},
});
