/** What the useshortly API answered, in terms tools can turn into a message for the model. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = undefined,
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
  constructor(code: string, message: string, readonly retryAfterSeconds: number | null) {
    super(429, code, message);
  }
}

/** Network failure, timeout, 5xx or a reply that is not what the API sends. Safe to retry later. */
export class ApiUnavailableError extends ApiError {
  constructor(message: string, cause?: unknown) {
    super(503, "unavailable", message);
    this.cause = cause;
  }
}
