/**
 * The single frontend error model (frontend.md#api-client) — every non-2xx response from the
 * backend is normalized into one `ApiError` the UI layer can branch on by `status`/`code`.
 *
 * The backend's error envelope is fixed by `apps/api/src/common/filters/http-exception.filter.ts`
 * (`packages/types`' `ApiErrorShape`): `{ statusCode, code, message, correlationId? }`. No other
 * fields are invented here — `details` is only ever populated from a `details` array the backend
 * actually sends (none do today; the field is kept typed so a future validation-detail contract
 * has a home without another refactor).
 */

/** The backend error envelope, exactly as `HttpExceptionFilter` serializes it. */
export interface ApiErrorShape {
  statusCode: number;
  code: string;
  message: string;
  correlationId?: string;
  details?: unknown;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    /** HTTP status. `0` means the request never got a response (network/DNS/TLS failure, abort). */
    readonly status: number,
    /** The backend's stable machine code (`UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, …) or
     * `NETWORK_ERROR` / `UNKNOWN_ERROR` when the response carried no usable envelope. */
    readonly code: string,
    message: string,
    readonly correlationId: string | undefined,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** True when the request failed before any HTTP response was received. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** 401 — the session is missing/expired. Distinct from {@link isForbidden}: the api client only
 * ever attempts a token refresh for this, never for a 403 (frontend.md / Prompt 016 §8). */
export function isAuthError(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 401;
}

/** 403 — authenticated but not allowed. Never treated as an authentication problem. */
export function isForbidden(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 403;
}

export function isNotFound(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 404;
}

/**
 * A short, user-facing sentence for an error — never a stack trace or raw backend message for a
 * 5xx. For 4xx the backend's own message is safe and specific (it is written for end users), so it
 * is preferred when present; the status-based text is the fallback.
 */
export function httpErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return 'Something went wrong. Please try again.';
  }
  if (error.isNetworkError) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  switch (error.status) {
    case 400:
    case 422:
      return error.message || 'Some of the information provided is invalid.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return "You don't have permission to do that.";
    case 404:
      return 'That item could not be found.';
    case 409:
      return error.message || 'That action conflicts with the current state.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    default:
      return error.status >= 500
        ? 'Something went wrong on our end. Please try again.'
        : error.message || 'Something went wrong. Please try again.';
  }
}
