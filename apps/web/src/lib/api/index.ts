/**
 * Client-safe barrel. `serverApiFetch` is intentionally NOT re-exported here — it pulls in
 * `next/headers` and must be imported from `@/lib/api/server` by Server Components only.
 */
export { apiFetch, type ApiFetchOptions } from './client';
export {
  ApiError,
  type ApiErrorShape,
  isApiError,
  isAuthError,
  isForbidden,
  isNotFound,
  httpErrorMessage,
} from './errors';
