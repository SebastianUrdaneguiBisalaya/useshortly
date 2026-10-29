/** What the useshortly API answered, in terms tools can turn into a message for the model. */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details: unknown = undefined
	) {
		super(message);
		this.name = new.target.name;
	}
}

/** 401: the API refused our token. The user is gone or the keys do not match: not something to retry. */
export class ApiAuthError extends ApiError {}
/** 403: the user may not do this (not a member, or the token's scope is too low). */
export class ApiForbiddenError extends ApiError {}
export class ApiNotFoundError extends ApiError {}
/** 400, 409, 413, 422: the request itself is wrong or conflicts with what exists. */
export class ApiRequestError extends ApiError {}

export class ApiRateLimitedError extends ApiError {
	constructor(
		code: string,
		message: string,
		readonly retryAfterSeconds: number | null
	) {
		super(429, code, message);
	}
}

/** Network failure, timeout, 5xx or a reply that is not what the API sends. Safe to retry later. */
export class ApiUnavailableError extends ApiError {
	constructor(message: string, cause?: unknown) {
		super(503, 'unavailable', message);
		this.cause = cause;
	}
}

/**
 * What to tell the model about an error code, so it can decide what to do next instead of repeating the call. Only the
 * codes a model can act on are here; for the rest the API's own message is enough.
 */
const codeHints: Record<string, string> = {
	campaign_url_too_long: 'The destination plus the campaign parameters must fit in 255 characters. Use a shorter URL, or a shorter campaign or channel name.',
	campaigns_disabled: 'Campaigns are not enabled on this useshortly server.',
	channel_not_found: "That channel does not exist in this organization. List the campaign's channels to see the valid ids.",
	invalid_description: 'A campaign description can have at most 500 characters.',
	invalid_filter: 'campaign_id and channel_id must be positive integers.',
	invalid_name: 'A campaign name has 1 to 100 characters and a channel name 1 to 50, without control characters.',
	invalid_range: 'from must not be after to, and the period can be at most 366 days. Dates are YYYY-MM-DD.',
	name_taken: 'That name is already in use (names are unique ignoring case). Choose another, or list the existing campaigns or channels and use the one that exists.',
	too_many_channels: 'A campaign has at most 100 channels. Reuse an existing channel, or delete one that is no longer used.',
};

/** A sentence that helps the model recover from this error code, or null when there is nothing to add. */
export function hintFor(code: string): string | null {
	return Object.hasOwn(codeHints, code) ? (codeHints[code] ?? null) : null;
}
