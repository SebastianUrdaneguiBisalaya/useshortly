import { index, layout, type RouteConfig, route } from '@react-router/dev/routes';

export default [
	layout('../features/protected/layout.tsx', [
		index('../features/protected/dashboard/dashboard.tsx'),
		route('links', '../features/protected/links/links.tsx'),
		route('users', '../features/protected/users/users.tsx'),
		route('api-keys', '../features/protected/api-keys/api-keys.tsx'),
	]),
	layout('../features/auth/layout.tsx', [
		route('auth/sign-in', '../features/auth/sign-in.tsx'),
		route('auth/sign-up', '../features/auth/sign-up.tsx'),
		route('auth/verify-email', '../features/auth/verify-email.tsx'),
		route('auth/forgot-password', '../features/auth/forgot-password.tsx'),
		route('auth/reset-password', '../features/auth/reset-password.tsx'),
	]),
] satisfies RouteConfig;
