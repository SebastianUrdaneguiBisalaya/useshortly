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
			'/api': process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080',
		},
	},
});
