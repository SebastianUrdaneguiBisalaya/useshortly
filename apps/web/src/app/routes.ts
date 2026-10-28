import { index, layout, type RouteConfig, route } from '@react-router/dev/routes';

export default [
	layout('../features/protected/layout.tsx', [
		index('../features/protected/dashboard/dashboard.tsx'),
		route('links', '../features/protected/links/links.tsx'),
		route('qr-code', '../features/protected/qr-code/qr-code.tsx'),
		route('campaigns', '../features/protected/campaigns/campaigns.tsx'),
		route('domains', '../features/protected/domains/domains.tsx'),
		route('users', '../features/protected/users/users.tsx'),
		route('api-keys', '../features/protected/api-keys/api-keys.tsx'),
		route('docs', '../features/protected/docs/docs.tsx'),
		route('mcp', '../features/protected/mcp/mcp.tsx'),
	]),
	layout('../features/auth/layout.tsx', [
		route('auth/sign-in', '../features/auth/sign-in.tsx'),
		route('auth/sign-up', '../features/auth/sign-up.tsx'),
		route('auth/verify-email', '../features/auth/verify-email.tsx'),
		route('auth/forgot-password', '../features/auth/forgot-password.tsx'),
		route('auth/reset-password', '../features/auth/reset-password.tsx'),
	]),
] satisfies RouteConfig;
