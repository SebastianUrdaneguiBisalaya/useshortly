import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), reactRouter()],
	resolve: {
		tsconfigPaths: true,
	},
	server: {
		// The backend has no CORS: in development the browser talks to Vite, which forwards the API.
		proxy: {
			// Regex (leading `^`) so `/api-keys`, a page, is not forwarded as if it were `/api/...`.
			'^/api/': process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080',
		},
	},
});
