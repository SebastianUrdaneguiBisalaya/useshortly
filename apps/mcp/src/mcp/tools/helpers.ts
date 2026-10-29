import type { UserApi } from '../../api/client.js';
import { ApiAuthError, ApiError, ApiForbiddenError, ApiNotFoundError, ApiRateLimitedError, ApiRequestError, ApiUnavailableError } from '../../api/errors.js';

/** What every tool gets: the API as the signed-in user, already limited to the granted scope. */
export type ToolContext = { api: UserApi };

export type ToolResult = {
	content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
};

export const ok = (text: string, data: Record<string, unknown>): ToolResult => ({
	content: [{ type: 'text', text }],
	structuredContent: data,
});

export const failed = (text: string): ToolResult => ({ isError: true, content: [{ type: 'text', text }] });

/** What the model is told when the API refuses. Written so it can decide what to do next. */
export function describeError(error: unknown): string {
	if (error instanceof ApiRateLimitedError) {
		return `useshortly is rate limiting this account. ${error.retryAfterSeconds ? `Retry in ${error.retryAfterSeconds} seconds.` : 'Retry in a little while.'}`;
	}
	if (error instanceof ApiAuthError) {
		return 'useshortly no longer accepts this connection (the account may have been deleted). Ask the user to reconnect.';
	}
	if (error instanceof ApiForbiddenError) {
		return `useshortly refused this action: ${error.message}. The user may lack access to this organization or did not grant the needed permission.`;
	}
	if (error instanceof ApiNotFoundError) return `Not found: ${error.message}. Check the id (list the items again to see valid ids).`;
	if (error instanceof ApiRequestError) {
		const details = error.details ? ` Details: ${JSON.stringify(error.details)}` : '';
		return `useshortly rejected the request: ${error.message}.${details}`;
	}
	if (error instanceof ApiUnavailableError) return 'useshortly is unavailable right now. Try again shortly.';
	if (error instanceof ApiError) return `useshortly answered with an error: ${error.message}`;
	return 'Something went wrong while talking to useshortly.';
}

/** Runs a tool and turns an API failure into a tool error the model can read, never a protocol error. */
export async function guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
	try {
		return await run();
	} catch (error) {
		if (!(error instanceof ApiError)) console.error('tool failed unexpectedly', error);
		return failed(describeError(error));
	}
}
